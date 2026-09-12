import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * F4's proof of done, against the real binary: a logo imported through the
 * host lands in the middle of the code, the gate verifies the code with the
 * logo in place, the exported file carries it, and a decoder that did not make
 * the code still reads the link. The hostile corpus is refused with a sentence
 * and nothing is stored.
 *
 * The open dialog cannot be driven by a WebDriver, so the suite hands the same
 * host command the path the dialog would have produced.
 */

const LINK = 'https://example.com/menu';

interface LogoInfo {
  id: string;
  name: string;
  kind: string;
  format: string;
  width: number;
  height: number;
  note: string | null;
  data_url: string;
}

type InvokeResult<T> = T | { __error: string };

/** A solid red 64×64 PNG: a logo whose colour can be found again in the exported file. */
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

describe('logo', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-logo-'));
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

  function decodePng(bytes: Buffer): string | null {
    const png = PNG.sync.read(bytes);
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  }

  it('imports a PNG through the host and reports what it is', async () => {
    const file = path.join(dir, 'brand.png');
    await writeFile(file, redSquarePng());
    const info = await invoke<LogoInfo>('import_logo', { path: file });
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
    const logo = info as LogoInfo;
    expect(logo.kind).toBe('raster');
    expect(logo.format).toBe('png');
    expect(logo.width).toBe(64);
    expect(logo.data_url.startsWith('data:image/png;base64,')).toBe(true);
    expect(logo.name).toBe('brand');
  });

  it('refuses the hostile corpus with a sentence, and stores nothing', async () => {
    const before = await invoke<LogoInfo[]>('list_logos', {});
    const count = Array.isArray(before) ? before.length : -1;
    const hostile: Array<[name: string, bytes: Buffer, expects: string]> = [
      [
        'script.svg',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
        'script',
      ],
      [
        'external.svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>',
        ),
        'outside',
      ],
      ['empty.png', Buffer.alloc(0), 'empty'],
      ['text.png', Buffer.from('this is not an image'), 'not an image'],
    ];
    for (const [name, bytes, expects] of hostile) {
      const file = path.join(dir, name);
      await writeFile(file, bytes);
      const result = await invoke<LogoInfo>('import_logo', { path: file });
      expect(result, name).toHaveProperty('__error');
      expect((result as { __error: string }).__error.toLowerCase(), name).toContain(expects);
    }
    const after = await invoke<LogoInfo[]>('list_logos', {});
    expect(Array.isArray(after) ? after.length : -2).toBe(count);
  });

  it('a PNG named .svg is read as a PNG, and the note says so', async () => {
    const file = path.join(dir, 'mislabelled.svg');
    await writeFile(file, redSquarePng());
    const info = await invoke<LogoInfo>('import_logo', { path: file });
    expect(info).not.toHaveProperty('__error');
    expect((info as LogoInfo).format).toBe('png');
    expect((info as LogoInfo).note ?? '').toContain('PNG');
  });

  it('the code carries the logo, the gate verifies it, and the link still reads back', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="Link"]');
    await input.sendKeys(LINK);
    await driver.waitForText('read it back byte for byte');

    // The dialog cannot be driven; the card lists the logos the host already holds, and one
    // button adopts it — the same door a person uses to reuse a logo.
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForElement('figure img');
    await driver.waitForText('read it back byte for byte');
    await session.screenshot('logo-light');

    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    // The box the screen drew the overlay at, read back from its own geometry.
    const box = await driver.execute<{ x: number; y: number; width: number; height: number }>(
      `const img = document.querySelector('figure img');
       const view = document.querySelector('figure svg').getAttribute('viewBox').split(' ');
       const side = Number(view[2]);
       const pct = (v) => (parseFloat(v) / 100) * side;
       return { x: pct(img.style.left), y: pct(img.style.top), width: pct(img.style.width), height: pct(img.style.height) };`,
    );
    const list = await invoke<LogoInfo[]>('list_logos', {});
    const brand = (list as LogoInfo[]).find((l) => l.name === 'brand');
    expect(brand).toBeDefined();
    expect(box).not.toBeNull();
    const file = path.join(dir, 'with-logo.png');
    const report = await invoke<{ verified: boolean }>('export_png', {
      svg,
      payload: LINK,
      pixel_size: 1024,
      path: file,
      logo: { id: brand?.id, ...box },
    });
    expect(report, JSON.stringify(report)).not.toHaveProperty('__error');

    const bytes = await readFile(file);
    expect(decodePng(bytes)).toBe(LINK);
    // The centre pixel of the exported file is the logo's red, not a module.
    const png = PNG.sync.read(bytes);
    const centre = (512 * png.width + 512) * 4;
    expect(png.data[centre]).toBeGreaterThan(180);
    expect(png.data[centre + 1]).toBeLessThan(80);
  });
});
