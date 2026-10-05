import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import jsQR from 'jsqr';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { proofSizes, type ProofSize } from '../src/domain/proof';
import { encodeText } from '../src/domain/qr/encode';
import { renderScene } from '../src/domain/scene';
import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * P1's proof of done, against the real binary: one A4 PDF with the code at 15, 20, 25 and 30 mm
 * (and the chosen size when it is none of those), each verified at its own pixel size before it
 * is drawn; a size that does not read is a box with the reason, never a picture; a 50 mm
 * calibration bar; every image on the page decodes with jsQR and measures its size in the PDF's
 * own units.
 *
 * The screen is driven to the button — a save dialog cannot be driven — and the host is asked
 * through the very command the button calls, with the domain's own plan of sizes.
 */

const LINK = 'https://example.com/menu';
const VERIFIED = 'read it back byte for byte';
const POINTS_PER_MM = 72 / 25.4;
const ARTEFACTS = path.join(import.meta.dirname, 'artefacts');

type InvokeResult<T> = T | { __error: string };

interface SheetReport {
  path: string;
  bytes_written: number;
  decoder: string;
  sizes: Array<{
    mm: number;
    chosen: boolean;
    verified: boolean;
    reason: string | null;
    verification_id: string | null;
  }>;
}

/** The page side the host writes for a width: points, rounded to the hundredth. */
function points(mm: number): number {
  return Math.round(mm * POINTS_PER_MM * 100) / 100;
}

function wire(sizes: ProofSize[]) {
  return sizes.map((s) => ({
    mm: s.mm,
    pixel_size: s.pixelSize,
    chosen: s.chosen,
    refused: s.refused,
  }));
}

/** Every image XObject in the file, inflated to RGBA, with its pixel size. */
function images(bytes: Buffer): Array<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const text = bytes.toString('latin1');
  const found: Array<{ width: number; height: number; rgba: Uint8ClampedArray }> = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('/Subtype /Image', from);
    if (at < 0) break;
    const dictStart = text.lastIndexOf('<<', at);
    const dictEnd = text.indexOf('stream', at);
    const dict = text.slice(dictStart, dictEnd);
    const width = Number(/\/Width\s+(\d+)/.exec(dict)?.[1]);
    const height = Number(/\/Height\s+(\d+)/.exec(dict)?.[1]);
    const streamStart = dictEnd + 'stream'.length;
    const dataStart = text.charAt(streamStart) === '\r' ? streamStart + 2 : streamStart + 1;
    const dataEnd = text.indexOf('endstream', dataStart);
    const rgb = inflateSync(bytes.subarray(dataStart, dataEnd));
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = rgb[i * 3] ?? 0;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    found.push({ width, height, rgba });
    from = dataEnd;
  }
  return found;
}

/** The widths every image is drawn at: the `a 0 0 d e f cm` before each `Do`. */
function placements(text: string): number[] {
  return [...text.matchAll(/([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm\s*\/\w+ Do/g)].map((m) =>
    Number(m[1]),
  );
}

describe('proof sheet', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-proof-'));
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

  async function theme(name: 'Light' | 'Dark' | 'Match Windows'): Promise<void> {
    const { driver } = session;
    await (
      await driver.findByXPath('//nav[@aria-label="Main"]//button[normalize-space(.)="Settings"]')
    ).click();
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const proofButtonDisabled = async () =>
    (await (
      await session.driver.findByXPath('//button[contains(normalize-space(.), "Proof sheet")]')
    ).attribute('disabled')) !== null;

  async function showExports(name: string): Promise<void> {
    await session.driver.execute(
      `const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Proof sheet'));
       b && b.scrollIntoView({ block: 'center' });`,
    );
    await session.screenshot(name);
  }

  it('offers the proof sheet only once the code on screen is verified', async () => {
    const { driver } = session;
    await theme('Light');
    await (
      await driver.findByXPath('//nav[@aria-label="Main"]//button[normalize-space(.)="Create"]')
    ).click();
    const field = await driver.waitForElement('input[aria-label="Link"]');
    await field.clear();
    await field.sendKeys(' ');
    await field.sendKeys(Keys.BACKSPACE);
    await field.sendKeys(LINK);
    await driver.waitForText(VERIFIED);
    await driver.waitFor('the proof sheet enabled', async () => !(await proofButtonDisabled()));
    await showExports('proof-create-light');
  });

  it('writes one A4 page where every code reads back and measures its size', async () => {
    const svg = await sceneOnScreen();
    const plan = proofSizes({ value: 25, unit: 'mm', dpi: 300 });
    const file = path.join(dir, 'menu-proof.pdf');
    const report = await invoke<SheetReport>('export_proof_sheet', {
      svg,
      payload: LINK,
      logo: null,
      dpi: 300,
      sizes: wire(plan.sizes),
      summary: 'Opens example.com',
      note: plan.note,
      path: file,
      code_id: null,
    });
    expect(report, JSON.stringify(report).slice(0, 400)).not.toHaveProperty('__error');
    const done = report as SheetReport;
    expect(done.sizes.map((s) => s.mm)).toEqual([15, 20, 25, 30]);
    expect(done.sizes.every((s) => s.verified)).toBe(true);
    expect(done.sizes.find((s) => s.chosen)?.mm).toBe(25);

    const bytes = await readFile(file);
    const text = bytes.toString('latin1');
    // Kept beside the captures, so the sheet itself is looked at, not only measured.
    await mkdir(ARTEFACTS, { recursive: true });
    await copyFile(file, path.join(ARTEFACTS, 'proof-sheet.pdf'));
    // A4 portrait, in points.
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595\.2\d*\s+841\.8\d*\s*\]/);
    // Every image is a verified raster that reads back as the link, at the pixels of its size.
    const found = images(bytes);
    expect(found).toHaveLength(4);
    expect(found.map((i) => i.width).sort((a, b) => a - b)).toEqual(
      plan.sizes.map((s) => s.pixelSize).sort((a, b) => a - b),
    );
    for (const image of found) {
      expect(jsQR(image.rgba, image.width, image.height)?.data, `${image.width} px`).toBe(LINK);
    }
    // Each image is drawn at exactly its size, in the PDF's own units.
    expect(placements(text).sort((a, b) => a - b)).toEqual(plan.sizes.map((s) => points(s.mm)));
    // The calibration bar: 50 mm wide, whatever the printer does to it afterwards.
    expect(text).toContain(`${points(50)} `);
    expect(text).toMatch(
      new RegExp(`${points(50).toFixed(2).replace('.', '\\.')}\\s+[\\d.]+\\s+re`),
    );
    expect(text).toContain('This bar is 50 mm');
    expect(text).toContain('Opens example.com');
    // Nothing about the person or the moment.
    expect(text).not.toMatch(/\/CreationDate|\/ModDate|\/Author|\/Title/);
  });

  it('draws a size that does not read as a box with the reason, never as a picture', async () => {
    // Dense enough that 15 mm at 150 dpi is barely a pixel per module.
    const payload = `https://example.com/${'x'.repeat(250)}`;
    const svg = renderScene(encodeText(payload, 'M')).svg;
    const plan = proofSizes({ value: 30, unit: 'mm', dpi: 150 });
    const file = path.join(dir, 'dense-proof.pdf');
    const report = await invoke<SheetReport>('export_proof_sheet', {
      svg,
      payload,
      logo: null,
      dpi: 150,
      sizes: wire(plan.sizes),
      summary: 'Opens example.com',
      note: plan.note,
      path: file,
      code_id: null,
    });
    expect(report, JSON.stringify(report).slice(0, 400)).not.toHaveProperty('__error');
    const done = report as SheetReport;
    const read = done.sizes.filter((s) => s.verified);
    const refused = done.sizes.filter((s) => !s.verified);
    expect(refused.map((s) => s.mm)).toContain(15);
    expect(read.length).toBeGreaterThan(0);
    for (const size of refused) {
      expect(size.reason).toBeTruthy();
      expect(size.verification_id === null || typeof size.verification_id === 'string').toBe(true);
    }
    const bytes = await readFile(file);
    await copyFile(file, path.join(ARTEFACTS, 'proof-sheet-dense.pdf'));
    const found = images(bytes);
    // Only the sizes that read are pictures.
    expect(found).toHaveLength(read.length);
    for (const image of found) {
      expect(jsQR(image.rgba, image.width, image.height)?.data).toBe(payload);
    }
    expect(placements(bytes.toString('latin1')).sort((a, b) => a - b)).toEqual(
      read.map((s) => points(s.mm)).sort((a, b) => a - b),
    );
  });

  it('writes nothing when no size reads', async () => {
    const file = path.join(dir, 'blank-proof.pdf');
    const blank =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#ffffff"/></svg>';
    const plan = proofSizes({ value: 25, unit: 'mm', dpi: 300 });
    const refused = await invoke<SheetReport>('export_proof_sheet', {
      svg: blank,
      payload: LINK,
      logo: null,
      dpi: 300,
      sizes: wire(plan.sizes),
      summary: 'Opens example.com',
      note: null,
      path: file,
      code_id: null,
    });
    expect(refused).toHaveProperty('__error');
    expect((refused as { __error: string }).__error).toContain('does not read at any size');
    await expect(stat(file)).rejects.toThrow();
  });

  it('shows the proof sheet in the dark theme too', async () => {
    await theme('Dark');
    await (
      await session.driver.findByXPath(
        '//nav[@aria-label="Main"]//button[normalize-space(.)="Create"]',
      )
    ).click();
    await session.driver.waitForText(VERIFIED);
    await showExports('proof-create-dark');
    await theme('Match Windows');
  });
});
