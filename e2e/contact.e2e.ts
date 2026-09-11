import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * F3's proof of done, against the real binary: a contact card filled in through
 * the screen becomes the exact vCard or MECARD its format prescribes, with every
 * field escaped, read back from the exported file by a decoder that did not make
 * it. Whether the card imports into a phone's contacts intact is the host proof —
 * a person with a phone — and is not claimed here.
 */

const FIELDS: Array<[label: string, value: string]> = [
  ['Given name', 'Ana'],
  ['Family name', "O'Brien; Jr"],
  ['Organisation', 'Example, Ltd'],
  ['Title', 'Engineer'],
  ['Phone', '+55 11 3333-0000'],
  ['Mobile', '+55 (11) 99999-0000'],
  ['E-mail', 'ana@example.com'],
  ['Website', 'https://example.com'],
  ['Street', 'Rua A, 1'],
  ['City', 'São Paulo'],
  ['Region', 'SP'],
  ['Postcode', '01000-000'],
  ['Country', 'Brazil'],
];

const VCARD3 =
  'BEGIN:VCARD\r\n' +
  'VERSION:3.0\r\n' +
  "N:O'Brien\\; Jr;Ana;;;\r\n" +
  "FN:Ana O'Brien\\; Jr\r\n" +
  'ORG:Example\\, Ltd\r\n' +
  'TITLE:Engineer\r\n' +
  'TEL;TYPE=WORK,VOICE:+551133330000\r\n' +
  'TEL;TYPE=CELL:+5511999990000\r\n' +
  'EMAIL;TYPE=INTERNET:ana@example.com\r\n' +
  'URL:https://example.com/\r\n' +
  'ADR;TYPE=WORK:;;Rua A\\, 1;São Paulo;SP;01000-000;Brazil\r\n' +
  'END:VCARD\r\n';

const MECARD =
  "MECARD:N:O'Brien\\; Jr,Ana;ORG:Example\\, Ltd;TEL:+551133330000;TEL:+5511999990000;" +
  'EMAIL:ana@example.com;URL:https\\://example.com/;ADR:Rua A\\, 1,São Paulo,SP,01000-000,Brazil;;';

type InvokeResult<T> = T | { __error: string };

describe('contact cards', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-contact-'));
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

  const sceneOnScreen = () =>
    session.driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );

  const payloadOnScreen = () =>
    session.driver.execute<string | null>(
      'const el = document.querySelector("figure figcaption"); return el ? el.textContent : null;',
    );

  function decodePng(bytes: Buffer): string | null {
    const png = PNG.sync.read(bytes);
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  }

  async function chooseFormat(label: string): Promise<void> {
    await session.driver.execute(
      `const select = document.querySelector('select[aria-label="Format"]');
       const option = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(label)});
       const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
    );
  }

  async function exportAndDecode(payload: string, name: string): Promise<string | null> {
    const svg = await sceneOnScreen();
    const file = path.join(dir, `${name}.png`);
    const report = await invoke<{ verified: boolean }>('export_png', {
      svg,
      payload,
      pixel_size: 1024,
      path: file,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    return decodePng(await readFile(file));
  }

  it('a filled card becomes the exact vCard 3.0, escaped, and a third decoder reads it', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab" and normalize-space(.)="Contact"]')).click();
    for (const [label, value] of FIELDS) {
      const field = await driver.waitForElement(`[aria-label="${label}"]`);
      await field.clear();
      await field.sendKeys(value);
    }
    await driver.waitForText("Adds Ana O'Brien; Jr to contacts");
    await driver.waitForText('read it back byte for byte');
    expect(await payloadOnScreen()).toContain("N:O'Brien\\; Jr;Ana;;;");
    await session.screenshot('contact-vcard3');
    expect(await exportAndDecode(VCARD3, 'card-vcard3')).toBe(VCARD3);
  });

  it('switching the format to MECARD gives the exact single line, and says the title is dropped', async () => {
    const { driver } = session;
    await chooseFormat('MECARD');
    await driver.waitForText('MECARD has no field for a title');
    await driver.waitForText('read it back byte for byte');
    expect(await exportAndDecode(MECARD, 'card-mecard')).toBe(MECARD);
  });

  it('vCard 4.0 carries its version and the tel URIs', async () => {
    const { driver } = session;
    await chooseFormat('vCard 4.0');
    await driver.waitForText('read it back byte for byte');
    const shown = await payloadOnScreen();
    expect(shown).toContain('VERSION:4.0');
    expect(shown).toContain('TEL;TYPE=cell;VALUE=uri:tel:+5511999990000');
    expect(shown).toContain('KIND:individual');
  });

  it('a long note makes the code dense, and the screen says so without blocking export', async () => {
    const { driver } = session;
    const note = await driver.waitForElement('[aria-label="Note"]');
    await note.sendKeys('Prefers e-mail before 10:00. '.repeat(30));
    await driver.waitForText('too small for most cameras');
    await driver.waitForText('read it back byte for byte');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).toBeNull();
    await session.screenshot('contact-dense');
  });

  it('refuses a card with no name, naming the field', async () => {
    const { driver } = session;
    for (const label of ['Given name', 'Family name']) {
      const field = await driver.waitForElement(`[aria-label="${label}"]`);
      // A bare clear does not reach React; a space typed and deleted is two real edits.
      await field.clear();
      await field.sendKeys(' ');
      await field.sendKeys(Keys.BACKSPACE);
    }
    await driver.waitForText('needs at least a name');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).not.toBeNull();
  });
});
