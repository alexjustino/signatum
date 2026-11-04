import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encodeText } from '../src/domain/qr/encode';
import { renderScene } from '../src/domain/scene';
import { answerDialog } from './dialog';
import { startSession, type Session } from './session';

/**
 * P2's proof of done, against the real binary: every exported PNG, SVG and PDF carries a stamp
 * that names what was verified and never when; Read says "verified by this workspace, unchanged"
 * for a stamped file, and "changed after it was verified" when one pixel or byte is edited; a
 * stamp copied onto another picture does not vouch for it; stamping can be turned off.
 *
 * The screen is driven too, through the real system dialog: `answerDialog` finds the dialog the
 * product opened and answers it through Windows UI Automation with a file the suite wrote.
 */

const LINK = 'https://example.com/menu';
const VERIFIED = 'read it back byte for byte';

type InvokeResult<T> = T | { __error: string };

interface StampCheck {
  stamped: boolean;
  intact: boolean;
  kind: 'png' | 'svg' | 'pdf';
  decoder: string | null;
  in_workspace: boolean;
  matches_record: boolean;
  verified_at: string | null;
  format: string | null;
  dpi: number | null;
  code_id: string | null;
  code_name: string | null;
}

/** The `tEXt` chunk whose keyword is `signatum`, as raw bytes, or null. */
function stampChunk(png: Buffer): Buffer | null {
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'tEXt' && png.toString('latin1', at + 8, at + 17) === 'signatum\0') {
      return png.subarray(at, at + 12 + length);
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return null;
}

/** A PNG with `chunk` inserted right before IEND. */
function withChunk(png: Buffer, chunk: Buffer): Buffer {
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

describe('verification stamp', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-stamp-'));
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

  const check = async (file: string) => {
    const result = await invoke<StampCheck>('check_file', { path: file });
    expect(result, JSON.stringify(result)).not.toHaveProperty('__error');
    return result as StampCheck;
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const sceneOnScreen = () =>
    session.driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );

  let png = '';
  let scene: string | null = null;
  let svgFile = '';
  let pdf = '';

  it('stamps every export, and says so for each one', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await driver.waitForElement('input[aria-label="Link"]');
    await driver.execute(
      `const input = document.querySelector('input[aria-label="Link"]');
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(LINK)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
    await driver.waitForText(VERIFIED);
    const svg = await sceneOnScreen();
    scene = svg;
    png = path.join(dir, 'menu.png');
    svgFile = path.join(dir, 'menu.svg');
    pdf = path.join(dir, 'menu.pdf');
    const base = { svg, payload: LINK, pixel_size: 295, logo: null, dpi: 300 };
    for (const [command, file, extra] of [
      ['export_png', png, {}],
      ['export_svg', svgFile, {}],
      ['export_pdf', pdf, { width_mm: 25 }],
    ] as const) {
      const done = await invoke(command, { ...base, ...extra, path: file });
      expect(done, `${command}: ${JSON.stringify(done)}`).not.toHaveProperty('__error');
    }
    for (const [file, kind] of [
      [png, 'png'],
      [svgFile, 'svg'],
      [pdf, 'pdf'],
    ] as const) {
      const result = await check(file);
      expect(result, file).toMatchObject({
        stamped: true,
        intact: true,
        kind,
        decoder: expect.stringMatching(/^rqrr /),
        in_workspace: true,
        matches_record: true,
        format: kind,
        dpi: 300,
      });
      expect(result.verified_at, file).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('carries no date, no path and no name in the file', async () => {
    const chunk = stampChunk(await readFile(png));
    expect(chunk).not.toBeNull();
    const text = (chunk as Buffer).toString('latin1', 17, (chunk as Buffer).length - 4);
    const stamp = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(stamp)).toEqual(['signatum', 'ref', 'decoder', 'digest']);
    expect(String(stamp.decoder)).toMatch(/^[a-z0-9_-]{1,32} \d+\.\d+\.\d+$/);
    // A v4 reference: the version digit is 4, and nothing in it is a time.
    expect(String(stamp.ref)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/);
    for (const file of [png, svgFile, pdf]) {
      const body = (await readFile(file)).toString('latin1');
      expect(body, file).not.toContain(dir);
      expect(body, file).not.toContain('menu');
      expect(body, file).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  it('says a file was changed after it was verified, one pixel or one byte', async () => {
    // One pixel, in an editor that keeps the stamp.
    const original = await readFile(png);
    const chunk = stampChunk(original) as Buffer;
    const image = PNG.sync.read(original);
    image.data[0] = image.data[0] === 0 ? 255 : 0;
    const edited = path.join(dir, 'edited.png');
    await writeFile(edited, withChunk(PNG.sync.write(image), chunk));
    // The real stamp, on pixels that are no longer the ones verified: changed, and nothing about
    // when or for which saved code — the workspace's facts are for an intact file only.
    expect(await check(edited)).toMatchObject({
      stamped: true,
      intact: false,
      verified_at: null,
      format: null,
      dpi: null,
      code_id: null,
      code_name: null,
    });

    // One byte of an SVG: a module's colour.
    const svgText = await readFile(svgFile, 'utf8');
    const changedSvg = path.join(dir, 'edited.svg');
    await writeFile(changedSvg, svgText.replace('#000000', '#000001'));
    expect(await check(changedSvg)).toMatchObject({ stamped: true, intact: false });

    // One byte of a PDF's picture.
    const pdfBytes = Buffer.from(await readFile(pdf));
    const streamAt = pdfBytes.indexOf('stream', pdfBytes.indexOf('/Subtype /Image')) + 10;
    pdfBytes[streamAt] = (pdfBytes[streamAt] ?? 0) ^ 0xff;
    const changedPdf = path.join(dir, 'edited.pdf');
    await writeFile(changedPdf, pdfBytes);
    expect(await check(changedPdf)).toMatchObject({ stamped: true, intact: false });
  });

  it('a stamp copied onto another picture vouches for nothing', async () => {
    const chunk = stampChunk(await readFile(png)) as Buffer;
    const other = PNG.sync.write(
      PNG.sync.read(
        Buffer.from(
          await (async () => {
            const scene = renderScene(encodeText('https://example.org/', 'M')).svg;
            const out = path.join(dir, 'other.png');
            const done = await invoke('export_png', {
              svg: scene,
              payload: 'https://example.org/',
              pixel_size: 295,
              logo: null,
              dpi: 300,
              path: out,
            });
            expect(done).not.toHaveProperty('__error');
            const bytes = await readFile(out);
            // Strip the other file's own stamp before borrowing the first one's.
            const own = stampChunk(bytes) as Buffer;
            return Buffer.concat([
              bytes.subarray(0, bytes.indexOf(own)),
              bytes.subarray(bytes.indexOf(own) + own.length),
            ]);
          })(),
        ),
      ),
    );
    const forged = path.join(dir, 'forged.png');
    await writeFile(forged, withChunk(other, chunk));
    expect(await check(forged)).toMatchObject({ stamped: true, intact: false });
  });

  it('the Read screen checks an exported file through its own door', async () => {
    const { driver } = session;
    await go('Read');
    await driver.waitForElement('h1');
    const answered1 = answerDialog(png);
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Check an exported file")]')
    ).click();
    await answered1;
    await driver.waitForElement('section[aria-label="Stamp"]');
    await driver.waitForText('Verified by this workspace on');
    await driver.waitForText('unchanged since');
    await session.screenshot('stamp-read-light');

    const edited = path.join(dir, 'edited.png');
    const answered2 = answerDialog(edited);
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Check an exported file")]')
    ).click();
    await answered2;
    await driver.waitForText('the file was changed after it was verified');
    await session.screenshot('stamp-read-changed-light');
  });

  it('a stamped PNG opened as an image shows its stamp above the code', async () => {
    const { driver } = session;
    const answered3 = answerDialog(png);
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Open an image")]')
    ).click();
    await answered3;
    await driver.waitForElement('[aria-label="Code 1"]');
    await driver.waitForElement('section[aria-label="Stamp"]');
    await driver.waitForText('Verified by this workspace on');
  });

  it('turning stamping off writes files without a stamp', async () => {
    const set = await invoke('settings_set', { key: 'stamp_exports', value: 'false' });
    expect(set, JSON.stringify(set)).toBeNull();
    const svg = scene;
    const plain = path.join(dir, 'plain.png');
    const done = await invoke('export_png', {
      svg,
      payload: LINK,
      pixel_size: 295,
      logo: null,
      dpi: 300,
      path: plain,
    });
    expect(done).not.toHaveProperty('__error');
    expect(stampChunk(await readFile(plain))).toBeNull();
    expect(await check(plain)).toMatchObject({ stamped: false });
    await invoke('settings_set', { key: 'stamp_exports', value: 'true' });
  });

  it('shows the stamp in the dark theme too', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Read');
    const answered4 = answerDialog(png);
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Check an exported file")]')
    ).click();
    await answered4;
    // The screen may still hold the previous door's reading, whose stamp says the same words: wait
    // for the caption only a check writes.
    await driver.waitForText('The file was checked for its stamp');
    await driver.waitForText('Verified by this workspace on');
    await session.screenshot('stamp-read-dark');
    await theme('Match Windows');
  });
});
