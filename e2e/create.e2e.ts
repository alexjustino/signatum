import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * F0's proof of done, against the real binary: a link typed becomes a code on
 * screen, is exported as a PNG, and a decoder that did not make it reads the
 * file on disk back as the same link.
 *
 * The export button opens the system's save dialog, which a WebDriver cannot
 * drive; the suite hands the same host command the path the dialog would have
 * produced, then reads the bytes from disk in Node and decodes them with jsQR —
 * a third lineage, after the encoder (Nayuki) and the host's decoder (rqrr).
 */

const LINK = 'https://example.com/menu';

interface Report {
  verified: boolean;
  decoder: string;
  decoded: string | null;
  artefact_sha256: string;
  width: number;
  height: number;
  path: string;
  bytes_written: number;
}

type InvokeResult<T> = T | { __error: string };

describe('create', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-export-'));
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

  it('a link typed becomes a code on screen, and the gate verifies it', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.sendKeys(LINK);
    await driver.waitForText('Opens example.com');
    await driver.waitForElement('figure[aria-label="QR code that opens example.com"] svg');
    await driver.waitForText('read it back byte for byte');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).toBeNull();
    await session.screenshot('create-verified');
  });

  it('exports a PNG that a third decoder reads back as the same link', async () => {
    const svg = await sceneOnScreen();
    expect(svg).not.toBeNull();
    const file = path.join(dir, 'menu.png');
    const report = await invoke<Report>('export_png', {
      svg,
      payload: LINK,
      pixel_size: 1024,
      path: file,
      dpi: 300,
    });
    expect(report).not.toHaveProperty('__error');
    const ok = report as Report;
    expect(ok.verified).toBe(true);
    expect(ok.decoder).toMatch(/^rqrr \d+\.\d+\.\d+$/);
    expect(ok.decoded).toBe(LINK);
    expect(ok.width).toBe(1024);
    expect(ok.height).toBe(1024);

    const bytes = await readFile(file);
    expect((await stat(file)).size).toBe(ok.bytes_written);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ok.artefact_sha256);
    expect(decodePng(bytes)).toBe(LINK);
  });

  it('refuses to write a file whose code says something else', async () => {
    const svg = await sceneOnScreen();
    const file = path.join(dir, 'wrong.png');
    const result = await invoke<Report>('export_png', {
      svg,
      payload: 'https://other.example/',
      pixel_size: 1024,
      path: file,
      dpi: 300,
    });
    expect(result).toHaveProperty('__error');
    expect((result as { __error: string }).__error).toContain('read something else');
    await expect(stat(file)).rejects.toThrow();
  });

  it('says why when the link is not a link', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.clear();
    await input.sendKeys('javascript:alert(1)');
    await driver.waitForText('has to start with https://');
    const button = await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]');
    expect(await button.attribute('disabled')).not.toBeNull();
  });

  it('renders the preview identically in the dark theme', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.clear();
    await input.sendKeys(LINK);
    await driver.waitForText('read it back byte for byte');
    const light = await sceneOnScreen();

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Dark"]')
    ).click();
    await driver.waitFor(
      'the dark theme',
      async () =>
        (await driver.execute<string | null>(
          'return document.documentElement.getAttribute("data-theme")',
        )) === 'dark',
    );
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Create"]')).click();
    // The draft survives the trip to Settings, and the gate verifies it again.
    await driver.waitForText('read it back byte for byte');
    // The code's colours are print colours, not theme tokens: the scene is byte-identical.
    expect(await sceneOnScreen()).toBe(light);
    await session.screenshot('create-dark');

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();
  });
});
