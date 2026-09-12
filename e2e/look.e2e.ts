import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * F6's proof of done, against the real binary: colours pass a contrast gate before the scan
 * gate is asked; a look that stops the code decoding cannot be exported, and the screen says
 * why; shaped modules and finders still read back from the file through a third decoder.
 */

const LINK = 'https://example.com/menu';

type InvokeResult<T> = T | { __error: string };

describe('look', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-look-'));
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const invoke = <T>(command: string, args: Record<string, unknown>) =>
    session.driver.executeAsync<InvokeResult<T>>(
      'const [command, args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  /** Set a colour field the way a person does: through its hex input. */
  async function setColour(label: string, hex: string): Promise<void> {
    await session.driver.execute(
      `const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(hex)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
  }

  async function choose(label: string, option: string): Promise<void> {
    await session.driver.execute(
      `const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]');
       const opt = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(option)});
       const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
       setter.call(select, opt.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
    );
  }

  const exportButton = () =>
    session.driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');

  const VERIFIED = 'read it back byte for byte';

  /**
   * A change to the look makes the old verdict disappear (the artefact changed) and, after the
   * debounce, a new one arrive. Waiting only for the verified text would match the old one.
   */
  async function reverified(): Promise<void> {
    await session.driver.waitForGone(VERIFIED);
    // The announcer keeps the last verdict in its live region, so the text alone would match the
    // old one; the export button is enabled only by a verdict about the code now on screen.
    await session.driver.waitFor(
      'the export button enabled by a fresh verdict',
      async () => (await (await exportButton()).attribute('disabled')) === null,
    );
  }

  it('a dark code on a light plate passes the contrast gate and verifies', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.sendKeys(LINK);
    await driver.waitForText('read it back byte for byte');
    await setColour('Code colour', '#1a1a1a');
    await reverified();
    expect(await (await exportButton()).attribute('disabled')).toBeNull();
    await session.screenshot('look-light');
  });

  it('colours too close are refused before the gate is asked, and the button says why', async () => {
    const { driver } = session;
    await setColour('Code colour', '#777777');
    await setColour('Background', '#999999');
    await driver.waitForText('too close');
    expect(await (await exportButton()).attribute('disabled')).not.toBeNull();
  });

  it('inverted colours are refused with the reason', async () => {
    const { driver } = session;
    await setColour('Code colour', '#ffffff');
    await setColour('Background', '#000000');
    await driver.waitForText('lighter than its background');
    expect(await (await exportButton()).attribute('disabled')).not.toBeNull();
    await setColour('Code colour', '#000000');
    await setColour('Background', '#ffffff');
    await driver.waitForText(VERIFIED);
  });

  it('dots and rounded finders verify, and a third decoder reads the file', async () => {
    const { driver } = session;
    await choose('Modules', 'Dots');
    await choose('Finders', 'Rounded');
    await reverified();
    await session.screenshot('look-dots');
    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    const file = path.join(dir, 'dots.png');
    const report = await invoke<{ verified: boolean }>('export_png', {
      svg,
      payload: LINK,
      pixel_size: 1024,
      path: file,
      dpi: 300,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    const png = PNG.sync.read(await readFile(file));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(LINK);
  });

  it('a quiet zone under four modules is warned about, and none at all is named', async () => {
    const { driver } = session;
    await choose('Modules', 'Square');
    await choose('Finders', 'Square');
    await reverified();
    await choose('Quiet zone', '2 modules');
    await driver.waitForText('under 4 modules');
    await choose('Quiet zone', 'None');
    await driver.waitForText('no quiet zone');
    await choose('Quiet zone', '4 modules (standard)');
    await reverified();
  });
});
