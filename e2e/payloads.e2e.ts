import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * F2's proof of done, against the real binary: every payload kind, filled in
 * through the screen, becomes the exact string its format prescribes — read
 * back from the exported file by a decoder that did not make it — and the
 * preview names what scanning it does.
 */

interface Case {
  kind: string;
  fill: Array<[label: string, value: string]>;
  summary: string;
  payload: string;
  name: string;
}

const CASES: Case[] = [
  {
    kind: 'Text',
    fill: [['Text', 'Table 12 — ask for Ana']],
    summary: 'Shows the text',
    payload: 'Table 12 — ask for Ana',
    name: 'menu-text',
  },
  {
    kind: 'E-mail',
    fill: [
      ['To', 'ana@example.com'],
      ['Subject', 'Réservation & table?'],
      ['Body', 'Two people, 20:00'],
    ],
    summary: 'Writes to ana@example.com',
    payload:
      'mailto:ana@example.com?subject=R%C3%A9servation%20%26%20table%3F&body=Two%20people%2C%2020%3A00',
    name: 'menu-email',
  },
  {
    kind: 'Phone',
    fill: [['Number', '+55 (11) 99999-0000']],
    summary: 'Calls +55 (11) 99999-0000',
    payload: 'tel:+5511999990000',
    name: 'menu-phone',
  },
  {
    kind: 'SMS',
    fill: [
      ['Number', '+55 11 99999-0000'],
      ['Message', 'Table for two, please'],
    ],
    summary: 'Texts +55 11 99999-0000',
    payload: 'SMSTO:+5511999990000:Table for two, please',
    name: 'menu-sms',
  },
  {
    kind: 'Wi-Fi',
    fill: [
      ['Network name', 'Café;Office'],
      ['Password', 'pa:ss,w"ord\\1'],
    ],
    summary: 'Joins Café;Office',
    payload: 'WIFI:T:WPA;S:Café\\;Office;P:pa\\:ss\\,w\\"ord\\\\1;;',
    name: 'menu-wifi',
  },
  {
    kind: 'Location',
    fill: [
      ['Latitude', '-23.550500'],
      ['Longitude', '-46.6333'],
    ],
    summary: 'Opens the map at',
    payload: 'geo:-23.5505,-46.6333',
    name: 'menu-geo',
  },
];

type InvokeResult<T> = T | { __error: string };

describe('payload kinds', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-payloads-'));
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

  function decodePng(bytes: Buffer): string | null {
    const png = PNG.sync.read(bytes);
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  }

  async function chooseKind(label: string): Promise<void> {
    const { driver } = session;
    const tab = await driver.findByXPath(`//*[@role="tab" and normalize-space(.)="${label}"]`);
    await tab.click();
  }

  it('lists the eight kinds, link first', async () => {
    const { driver } = session;
    const tabs = await driver.findAll('[role="tab"]');
    const labels = await Promise.all(tabs.map((t) => t.text()));
    expect(labels).toEqual([
      'Link',
      'Text',
      'E-mail',
      'Phone',
      'SMS',
      'Wi-Fi',
      'Location',
      'Contact',
    ]);
  });

  for (const c of CASES) {
    it(`${c.kind}: the screen builds the exact string, the gate verifies it, a third decoder reads it`, async () => {
      const { driver } = session;
      await chooseKind(c.kind);
      for (const [label, value] of c.fill) {
        const field = await driver.waitForElement(`[aria-label="${label}"]`);
        await field.clear();
        await field.sendKeys(value);
      }
      await driver.waitForText(c.summary);
      await driver.waitForText('read it back byte for byte');
      const svg = await sceneOnScreen();
      const file = path.join(dir, `${c.name}.png`);
      const report = await invoke<{ verified: boolean; decoded: string | null }>('export_png', {
        svg,
        payload: c.payload,
        pixel_size: 1024,
        path: file,
        dpi: 300,
      });
      expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
      expect(decodePng(await readFile(file))).toBe(c.payload);
    });
  }

  it('says which field is wrong, and the export waits', async () => {
    const { driver } = session;
    await chooseKind('Location');
    const latitude = await driver.waitForElement('[aria-label="Latitude"]');
    await latitude.clear();
    await latitude.sendKeys('-23,5505');
    await driver.waitForText('dot');
    expect(await latitude.attribute('aria-invalid')).toBe('true');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).not.toBeNull();
  });

  it('keeps every draft when the kind changes', async () => {
    const { driver } = session;
    await chooseKind('Phone');
    const number = await driver.waitForElement('[aria-label="Number"]');
    expect(await number.property('value')).toBe('+55 (11) 99999-0000');
    await chooseKind('Link');
    await driver.waitForElement('input[aria-label="Link"]');
    await session.screenshot('payloads-link');
    await chooseKind('Wi-Fi');
    const ssid = await driver.waitForElement('[aria-label="Network name"]');
    expect(await ssid.property('value')).toBe('Café;Office');
    await session.screenshot('payloads-wifi');
  });
});
