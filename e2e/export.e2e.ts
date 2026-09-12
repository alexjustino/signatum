import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * F7's proof of done, against the real binary: a 25 mm code at 300 dpi is 295 pixels wide and
 * says so in its pHYs chunk; the SVG carries its width in millimetres and a third decoder reads
 * it once rasterised; the PDF's page measures 25 mm in points and the image inside it decodes;
 * the scan margin is reported. Every file is read back by a decoder that did not make it.
 */

const LINK = 'https://example.com/menu';
const MM = 25;
const DPI = 300;
const PX = 295;
const POINTS = '70.87';

type InvokeResult<T> = T | { __error: string };

interface Report {
  verified: boolean;
  decoder: string;
  width: number;
  height: number;
  path?: string;
}

function decodeRgba(data: Uint8ClampedArray, width: number, height: number): string | null {
  return jsQR(data, width, height)?.data ?? null;
}

/** The pHYs chunk of a PNG, or null: pixels per unit on both axes and the unit flag. */
function readPhys(bytes: Buffer): { x: number; y: number; unit: number } | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'pHYs') {
      return {
        x: bytes.readUInt32BE(offset + 8),
        y: bytes.readUInt32BE(offset + 12),
        unit: bytes.readUInt8(offset + 16),
      };
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return null;
}

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

describe('size and export', () => {
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

  it('the screen sizes the code: 25 mm at 300 dpi is 295 pixels', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.sendKeys(LINK);
    await driver.waitForText('read it back byte for byte');
    await driver.waitForText(`${PX} × ${PX} px`);
    await session.screenshot('export-light');
  });

  it('the PNG is 295 pixels wide and its pHYs says 300 dpi', async () => {
    const svg = await sceneOnScreen();
    const file = path.join(dir, 'code.png');
    const report = await invoke<Report>('export_png', {
      svg,
      payload: LINK,
      pixel_size: PX,
      path: file,
      logo: null,
      dpi: DPI,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    expect((report as Report).width).toBe(PX);
    const bytes = await readFile(file);
    const png = PNG.sync.read(bytes);
    expect(png.width).toBe(PX);
    expect(readPhys(bytes)).toEqual({ x: 11811, y: 11811, unit: 1 });
    expect(decodeRgba(new Uint8ClampedArray(png.data), png.width, png.height)).toBe(LINK);
  });

  it('the SVG carries its width in millimetres, and a third decoder reads it rasterised', async () => {
    const svg = await sceneOnScreen();
    expect(svg).not.toBeNull();
    // The domain sizes the SVG; the suite does the same insertion the screen does.
    const sized = (svg ?? '').replace(
      /(<svg\b[^>]*?viewBox="[^"]*")/,
      `$1 width="${MM}mm" height="${MM}mm"`,
    );
    const file = path.join(dir, 'code.svg');
    const report = await invoke<Report>('export_svg', {
      svg: sized,
      payload: LINK,
      pixel_size: PX,
      path: file,
      logo: null,
      dpi: DPI,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    const written = await readFile(file, 'utf8');
    expect(written).toContain(`width="${MM}mm" height="${MM}mm"`);
    expect(written).not.toMatch(/<script|foreignObject|href="http/);
    const { data, info } = await sharp(Buffer.from(written))
      .resize(PX * 2, PX * 2)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decodeRgba(new Uint8ClampedArray(data), info.width, info.height)).toBe(LINK);
  });

  it('the PDF page measures 25 mm in points, and the image inside it decodes', async () => {
    const svg = await sceneOnScreen();
    const file = path.join(dir, 'code.pdf');
    const report = await invoke<Report>('export_pdf', {
      svg,
      payload: LINK,
      pixel_size: PX,
      path: file,
      logo: null,
      dpi: DPI,
      width_mm: MM,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    const bytes = await readFile(file);
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(new RegExp(`/MediaBox\\s*\\[\\s*0\\s+0\\s+${POINTS}\\s+${POINTS}\\s*\\]`));
    expect(text).toMatch(/\/Subtype\s*\/Image/);
    expect(text).toMatch(new RegExp(`/Width\\s+${PX}`));
    // The image stream: FlateDecode RGB, 295 × 295 × 3 bytes once inflated.
    const streamStart = text.indexOf('stream', text.indexOf('/Subtype /Image')) + 'stream'.length;
    const dataStart = text.charAt(streamStart) === '\r' ? streamStart + 2 : streamStart + 1;
    const dataEnd = text.indexOf('endstream', dataStart);
    const rgb = inflateSync(bytes.subarray(dataStart, dataEnd));
    expect(rgb.length).toBe(PX * PX * 3);
    const rgba = new Uint8ClampedArray(PX * PX * 4);
    for (let i = 0; i < PX * PX; i += 1) {
      rgba[i * 4] = rgb[i * 3] ?? 0;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    expect(decodeRgba(rgba, PX, PX)).toBe(LINK);
  });

  it('with a logo the SVG embeds it as a data image, and still reads', async () => {
    const { driver } = session;
    const logoFile = path.join(dir, 'brand.png');
    await writeFile(logoFile, redSquarePng());
    const info = await invoke<{ id: string }>('import_logo', { path: logoFile });
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForElement('figure img');
    await driver.waitForText('Level H');
    await driver.waitForText('read it back byte for byte');
    const svg = await sceneOnScreen();
    const box = await driver.execute<{ x: number; y: number; width: number; height: number }>(
      `const img = document.querySelector('figure img');
       const view = document.querySelector('figure svg').getAttribute('viewBox').split(' ');
       const side = Number(view[2]);
       const pct = (v) => (parseFloat(v) / 100) * side;
       return { x: pct(img.style.left), y: pct(img.style.top), width: pct(img.style.width), height: pct(img.style.height) };`,
    );
    const file = path.join(dir, 'with-logo.svg');
    const report = await invoke<Report>('export_svg', {
      svg: (svg ?? '').replace(
        /(<svg\b[^>]*?viewBox="[^"]*")/,
        `$1 width="${MM}mm" height="${MM}mm"`,
      ),
      payload: LINK,
      pixel_size: PX * 2,
      path: file,
      logo: { id: (info as { id: string }).id, ...box },
      dpi: DPI,
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');
    const written = await readFile(file, 'utf8');
    expect(written).toContain('data:image/png;base64,');
    const { data, info: raster } = await sharp(Buffer.from(written))
      .resize(PX * 3, PX * 3)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decodeRgba(new Uint8ClampedArray(data), raster.width, raster.height)).toBe(LINK);
  });

  it('copies a verified PNG to the clipboard, and reports the scan margin', async () => {
    const { driver } = session;
    const copied = await invoke<Report>('copy_png', {
      svg: await sceneOnScreen(),
      payload: LINK,
      pixel_size: PX * 2,
      logo: null,
      dpi: DPI,
    });
    expect(copied, JSON.stringify(copied)).not.toHaveProperty('__error');
    expect((copied as Report).verified).toBe(true);
    await driver.waitForText('Shrunk to 25 %');
    await driver.waitForText('JPEG quality 25');
    // The margin card sits under the export row; bring it into the capture.
    await driver.execute(
      'document.querySelector("main").scrollTo({ top: document.querySelector("main").scrollHeight });',
    );
    await session.screenshot('export-margin');
  });
});
