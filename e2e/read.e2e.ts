import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encodeText, type Ecl } from '../src/domain/qr/encode';
import { renderScene } from '../src/domain/scene';
import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * F10's proof of done, against the real binary: images of codes decode with the kind, version,
 * error correction and mask named; an image with no code says so; "would it scan at X mm" is
 * answered; an internationalised host is shown in Unicode beside its punycode.
 *
 * Two doors, both real: the screen is driven through the clipboard (a code copied by the
 * product's own `copy_png`, then "Paste from clipboard" — a dialog cannot be driven), and the
 * host through `read_image` on a corpus the suite renders with sharp: clean, a synthetic
 * screenshot, a rotated print, two codes side by side, and noise. Real photographs live under
 * `e2e/fixtures/read/photos/` when they exist; until then that test skips by name.
 */

const LINK = 'https://example.com/menu';
const IDN = 'https://xn--bcher-kva.example/';
const VERIFIED = 'read it back byte for byte';
const PHOTOS = path.join(__dirname, 'fixtures', 'read', 'photos');

type InvokeResult<T> = T | { __error: string };

interface FoundCode {
  bytes: string;
  text: string;
  version: number | null;
  ecl: Ecl | null;
  mask: number | null;
  side_modules: number;
  corners: [number, number][];
  error: string | null;
}

interface Reading {
  width: number;
  height: number;
  preview: string;
  codes: FoundCode[];
  note: string | null;
  decode_ms: number;
}

/** The product's own SVG for a payload, at a level, drawn with the default look. */
function svgOf(payload: string, ecl: Ecl): string {
  return renderScene(encodeText(payload, ecl)).svg;
}

describe('read', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-read-'));
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

  const readImage = async (file: string): Promise<Reading> => {
    const result = await invoke<Reading>('read_image', { path: file });
    expect(result, JSON.stringify(result).slice(0, 300)).not.toHaveProperty('__error');
    return result as Reading;
  };

  const go = async (label: string) => {
    await (
      await session.driver.findByXPath(
        `//nav[@aria-label="Main"]//button[normalize-space(.)="${label}"]`,
      )
    ).click();
  };

  async function theme(name: 'Light' | 'Dark' | 'Match Windows'): Promise<void> {
    const { driver } = session;
    await go('Settings');
    await (
      await driver.findByXPath(`//button[@role="radio" and normalize-space(.)="${name}"]`)
    ).click();
    const expected = name === 'Match Windows' ? null : name.toLowerCase();
    await driver.waitFor(
      `the ${name} theme`,
      async () =>
        (await driver.execute<string | null>(
          'return document.documentElement.getAttribute("data-theme")',
        )) === expected,
    );
  }

  async function typeInto(label: string, value: string): Promise<void> {
    const field = await session.driver.waitForElement(`input[aria-label="${label}"]`);
    await field.clear();
    await field.sendKeys(' ');
    await field.sendKeys(Keys.BACKSPACE);
    await field.sendKeys(value);
  }

  /** A PNG of the payload's code at a pixel size, optionally rotated, with a border. */
  async function pngOf(
    name: string,
    payload: string,
    ecl: Ecl,
    { size = 600, rotate = 0, border = 0 }: { size?: number; rotate?: number; border?: number },
  ): Promise<string> {
    let image = sharp(Buffer.from(svgOf(payload, ecl)))
      .resize(size, size)
      .flatten({
        background: '#ffffff',
      });
    if (border > 0) {
      image = sharp(await image.png().toBuffer()).extend({
        top: border,
        bottom: border,
        left: border,
        right: border,
        background: '#8a8a8a',
      });
    }
    if (rotate !== 0) {
      image = sharp(await image.png().toBuffer()).rotate(rotate, { background: '#ffffff' });
    }
    const file = path.join(dir, name);
    await writeFile(file, await image.png().toBuffer());
    return file;
  }

  it('reads a code the product copied to the clipboard, and says how it was built', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await typeInto('Link', LINK);
    await driver.waitForText(VERIFIED);
    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    const copied = await invoke<{ verified: boolean }>('copy_png', {
      svg,
      payload: LINK,
      pixel_size: 512,
      logo: null,
      dpi: 300,
    });
    expect(copied, JSON.stringify(copied)).not.toHaveProperty('__error');
    expect((copied as { verified: boolean }).verified).toBe(true);

    await go('Read');
    await driver.waitForElement('h1');
    await (await driver.findByXPath('//button[normalize-space(.)="Paste from clipboard"]')).click();
    await driver.waitForElement('[aria-label="Code 1"]');
    await driver.waitForText('Opens example.com');
    await driver.waitForText('1 code');
    const built = await (
      await driver.findByXPath(
        '//*[@aria-label="Code 1"]//*[contains(normalize-space(.), "Version ")]',
      )
    ).text();
    expect(built).toMatch(/Version \d+ · Level [LMQH] · Mask [0-7] · \d+ modules/);
    await driver.waitForText(LINK);
    // The card is under the image; bring it into the capture.
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('read-light');
  });

  it('answers whether the code would scan at a printed width', async () => {
    const { driver } = session;
    // 25 mm is the default: a short link at version 2 or 3 reads comfortably.
    await driver.waitForText('most cameras read that from 30 cm');
    const width = await driver.waitForElement('input[aria-label="Printed width"]');
    await width.clear();
    await width.sendKeys(' ');
    await width.sendKeys(Keys.BACKSPACE);
    await width.sendKeys('8');
    await driver.waitForText('too small for most cameras');
    await width.sendKeys(Keys.BACKSPACE);
    await width.sendKeys('60');
    await driver.waitForText('At 60 mm the modules are');
    await driver.waitForText('most cameras read that from 30 cm');
  });

  it('shows the reading in the dark theme too', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Read');
    await driver.waitForElement('[aria-label="Code 1"]');
    // The card is under the image; bring it into the capture.
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('read-dark');
    await theme('Match Windows');
  });

  it('reads a clean image and names version, level and mask', async () => {
    const file = await pngOf('clean.png', LINK, 'Q', {});
    const reading = await readImage(file);
    expect(reading.codes).toHaveLength(1);
    const code = reading.codes[0];
    // The encoder may raise the level when it costs no extra version, so the expectation is
    // what the matrix says it is, not what was asked for.
    const made = encodeText(LINK, 'Q');
    expect(code?.text).toBe(LINK);
    expect(code?.ecl).toBe(made.ecl);
    expect(code?.version).toBe(made.version);
    expect(code?.side_modules).toBe(made.size);
    expect(code?.mask).toBe(made.mask);
    expect(code?.corners).toHaveLength(4);
    for (const [x, y] of code?.corners ?? []) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(reading.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(reading.height);
    }
    expect(reading.preview.startsWith('data:image/png;base64,')).toBe(true);
    expect(reading.note).toBeNull();
  });

  it('reads a screenshot with a border, a rotated print, and every level', async () => {
    const shot = await readImage(await pngOf('shot.png', LINK, 'M', { size: 450, border: 60 }));
    expect(shot.codes[0]?.text).toBe(LINK);
    const turned = await readImage(await pngOf('turned.png', LINK, 'H', { rotate: 15 }));
    expect(turned.codes[0]?.text).toBe(LINK);
    for (const ecl of ['L', 'M', 'Q', 'H'] as const) {
      const reading = await readImage(await pngOf(`level-${ecl}.png`, LINK, ecl, { size: 400 }));
      expect(reading.codes[0]?.ecl, `level ${ecl}`).toBe(encodeText(LINK, ecl).ecl);
    }
  });

  it('finds two codes in one image, and none in noise', async () => {
    const left = await sharp(Buffer.from(svgOf(LINK, 'M')))
      .resize(300, 300)
      .png()
      .toBuffer();
    const right = await sharp(Buffer.from(svgOf(IDN, 'M')))
      .resize(300, 300)
      .png()
      .toBuffer();
    const pair = path.join(dir, 'pair.png');
    await writeFile(
      pair,
      await sharp({
        create: { width: 700, height: 340, channels: 3, background: '#ffffff' },
      })
        .composite([
          { input: left, left: 20, top: 20 },
          { input: right, left: 380, top: 20 },
        ])
        .png()
        .toBuffer(),
    );
    const two = await readImage(pair);
    expect(two.codes.map((c) => c.text).sort()).toEqual([LINK, IDN].sort());

    const pixels = Buffer.alloc(400 * 400 * 3);
    let seed = 12345;
    for (let i = 0; i < pixels.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels[i] = seed & 0xff;
    }
    const noise = path.join(dir, 'noise.png');
    await writeFile(
      noise,
      await sharp(pixels, { raw: { width: 400, height: 400, channels: 3 } })
        .png()
        .toBuffer(),
    );
    const nothing = await readImage(noise);
    expect(nothing.codes).toHaveLength(0);
    expect(nothing.note).toBe('No QR code was found in this image.');
  });

  it('refuses an SVG for reading, and never echoes the path', async () => {
    const file = path.join(dir, 'vector.svg');
    await writeFile(file, svgOf(LINK, 'M'));
    const refused = await invoke<Reading>('read_image', { path: file });
    expect(refused).toHaveProperty('__error');
    const message = (refused as { __error: string }).__error;
    expect(message).toContain('open an SVG as a logo instead');
    expect(message).not.toContain(dir);
  });

  const photos = existsSync(path.join(PHOTOS, 'expected.csv'));
  it.skipIf(!photos)('reads every photograph in the corpus', async () => {
    const rows = (await readFile(path.join(PHOTOS, 'expected.csv'), 'utf8'))
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line.length > 0)
      .map((line) => {
        const comma = line.indexOf(',');
        return { file: line.slice(0, comma), payload: line.slice(comma + 1) };
      });
    expect(rows.length).toBeGreaterThan(0);
    const present = (await readdir(PHOTOS)).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
    expect(present.sort()).toEqual(rows.map((r) => r.file).sort());
    for (const row of rows) {
      // A phone photograph carries where and when it was taken; none of that is committed.
      const meta = await sharp(path.join(PHOTOS, row.file)).metadata();
      expect(meta.exif, `${row.file} still carries EXIF`).toBeUndefined();
      const reading = await readImage(path.join(PHOTOS, row.file));
      expect(
        reading.codes.map((c) => c.text),
        row.file,
      ).toContain(row.payload);
    }
  });
});
