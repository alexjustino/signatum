import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * F5's proof of done, against the real binary: the placement engine sizes the logo from the
 * error-correction budget, chooses level and version for it, and a code that cannot carry a
 * logo is refused with the reason. What the engine allows still reads back from the file.
 */

const LINK = 'https://example.com/menu';

type InvokeResult<T> = T | { __error: string };

function redSquarePng(): Buffer {
  const png = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 220;
    png.data[i + 1] = 30;
    png.data[i + 2] = 30;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('placement', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-placement-'));
    session = await startSession();
    const file = path.join(dir, 'brand.png');
    await writeFile(file, redSquarePng());
    const info = await session.driver.executeAsync<InvokeResult<{ id: string }>>(
      'const [args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke("import_logo", args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [{ path: file }],
    );
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
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

  const overlayWidth = () =>
    session.driver.execute<number>(
      'const img = document.querySelector("figure img"); return img ? parseFloat(img.style.width) : -1;',
    );

  const sceneOnScreen = () =>
    session.driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );

  const box = () =>
    session.driver.execute<{ x: number; y: number; width: number; height: number }>(
      `const img = document.querySelector('figure img');
       const view = document.querySelector('figure svg').getAttribute('viewBox').split(' ');
       const side = Number(view[2]);
       const pct = (v) => (parseFloat(v) / 100) * side;
       return { x: pct(img.style.left), y: pct(img.style.top), width: pct(img.style.width), height: pct(img.style.height) };`,
    );

  async function setLink(text: string): Promise<void> {
    const input = await session.driver.waitForElement('input[aria-label="Link"]');
    await input.clear();
    await input.sendKeys(' ');
    await input.sendKeys(Keys.BACKSPACE);
    await input.sendKeys(text);
  }

  async function chooseSize(label: string): Promise<void> {
    await session.driver.execute(
      `const select = document.querySelector('select[aria-label="Size"]');
       const option = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(label)});
       const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
    );
  }

  it('with a logo the plan goes to level H, and the file still reads back', async () => {
    const { driver } = session;
    await setLink(LINK);
    await driver.waitForText('read it back byte for byte');
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForElement('figure img');
    await driver.waitForText('Level H');
    await driver.waitForText('read it back byte for byte');
    await session.screenshot('placement-largest');

    const list = await invoke<Array<{ id: string; name: string }>>('list_logos', {});
    const brand = (list as Array<{ id: string; name: string }>).find((l) => l.name === 'brand');
    const file = path.join(dir, 'largest.png');
    const report = await invoke<{ verified: boolean }>('export_png', {
      svg: await sceneOnScreen(),
      payload: LINK,
      pixel_size: 1024,
      path: file,
      logo: { id: brand?.id, ...(await box()) },
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    const png = PNG.sync.read(await readFile(file));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(LINK);
  });

  it('on a version whose centre is an alignment pattern, the plate sits on it and the code reads', async () => {
    const { driver } = session;
    // 64 bytes need version 7 at H.
    const text = 'https://example.com/' + 'x'.repeat(44);
    await setLink(text);
    await driver.waitForText('version 7');
    await driver.waitForText('read it back byte for byte');
    await session.screenshot('placement-version-7');
  });

  it('a smaller size gives a smaller logo, never a larger one', async () => {
    // On a short link the budget already limits the logo to the smallest square, so every
    // size is the same; on the version-7 code the sizes differ, which is what is asserted.
    const { driver } = session;
    const largest = await overlayWidth();
    await chooseSize('Small');
    await driver.waitForText('read it back byte for byte');
    const small = await overlayWidth();
    expect(small).toBeLessThan(largest);
    await chooseSize('Largest');
    await driver.waitForText('read it back byte for byte');
    expect(await overlayWidth()).toBe(largest);
  });

  it('refuses content that fits without a logo but not with one, and says why', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab" and normalize-space(.)="Text"]')).click();
    const text = await driver.waitForElement('[aria-label="Text"]');
    await text.sendKeys('x'.repeat(2000));
    await driver.waitForText('does not fit');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).not.toBeNull();
    await session.screenshot('placement-refused');
  });
});
