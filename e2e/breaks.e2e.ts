import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { answerDialog } from './dialog';
import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * P9's proof of done, against the real binary: the card says where a code with a logo breaks, in
 * millimetres; the weakest spot, smudged, is past the code's guarantee and the gate's own decoder
 * agrees that it no longer reads; a stroke drawn with a real pointer over two modules stays within
 * the guarantee and the decoder still reads it; and the host refuses damage that is not on the
 * code. The host's own tests prove the check records nothing (ADR-037).
 */

const LINK = 'https://example.com/menu';
const VERIFIED = 'read it back byte for byte';
/** Version 3 at level H, with the default quiet zone of four modules. */
const SIZE = 29;
const QUIET = 4;

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

describe('where it breaks', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-breaks-'));
    session = await startSession();
    const file = path.join(dir, 'brand.png');
    await writeFile(file, redSquarePng());
    const info = await invoke<{ id: string }>('import_logo', { path: file });
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
  });

  afterAll(async () => {
    await session?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  function invoke<T>(command: string, args: Record<string, unknown>) {
    return session.driver.executeAsync<InvokeResult<T>>(
      'const [command, args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );
  }

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

  const card = '//section[@aria-label="Where it breaks"]';

  const clickInCard = async (text: string) => {
    await (
      await session.driver.findByXPath(`${card}//button[normalize-space(.)="${text}"]`)
    ).click();
  };

  const result = () =>
    session.driver.execute<string>(
      `const p = document.querySelector('section[aria-label="Where it breaks"] p[aria-live="polite"]');
       return p ? p.textContent.trim() : '';`,
    );

  async function waitForResult(what: string, test: (text: string) => boolean): Promise<string> {
    let last = '';
    await session.driver.waitFor(what, async () => {
      last = await result();
      return test(last);
    });
    return last;
  }

  /** The card's own copy of the code, centred on screen: what a capture should show. */
  const scrollDrawingIntoView = () =>
    session.driver.execute(
      `document.querySelector('section[aria-label="Where it breaks"] figure').scrollIntoView({ block: "center" })`,
    );

  const scrollCardIntoView = () =>
    session.driver.execute(
      `document.querySelector('section[aria-label="Where it breaks"]').scrollIntoView({ block: "start" })`,
    );

  /** The overlay on the preview: its side in scene modules and where it sits on screen. */
  const overlay = () =>
    session.driver.execute<{ side: number; left: number; top: number; width: number } | null>(
      `const svg = [...document.querySelectorAll('section[aria-label="Where it breaks"] figure svg[aria-hidden="true"]')].pop();
       if (!svg) return null;
       const r = svg.getBoundingClientRect();
       return { side: Number(svg.getAttribute('viewBox').split(' ')[2]), left: r.left, top: r.top, width: r.width };`,
    );

  /** Where a module's centre is on screen right now, with the drawing centred first. */
  async function pointOf(x: number, y: number): Promise<{ x: number; y: number }> {
    await scrollDrawingIntoView();
    const box = await overlay();
    expect(box?.side).toBe(SIZE + 2 * QUIET);
    if (box === null) throw new Error('no overlay');
    const module = box.width / box.side;
    return {
      x: box.left + (x + QUIET + 0.5) * module,
      y: box.top + (y + QUIET + 0.5) * module,
    };
  }

  const chooseBrush = async (name: 'Ink' | 'Paper') => {
    await (
      await session.driver.findByXPath(`${card}//*[@role="radio" and normalize-space(.)="${name}"]`)
    ).click();
  };

  const damageShown = () =>
    session.driver.execute<number>(
      `const svg = document.querySelector('section[aria-label="Where it breaks"] figure svg[aria-hidden="true"]');
       return svg ? svg.querySelectorAll('rect').length : 0;`,
    );

  const cardText = () =>
    session.driver.execute<string>(
      `const c = document.querySelector('section[aria-label="Where it breaks"]');
       return c ? c.textContent : '';`,
    );

  /** Press the product's own Export PNG button, answer the real dialog, and read the pixels back. */
  async function exportPixels(name: string): Promise<{ file: string; png: PNG }> {
    const { driver } = session;
    const file = path.join(dir, name);
    const answered = answerDialog(file);
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]')
    ).click();
    await answered;
    await driver.waitFor(`${name} on disk`, async () => existsSync(file));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { file, png: PNG.sync.read(await readFile(file)) };
  }

  async function setLink(text: string): Promise<void> {
    const input = await session.driver.waitForElement('input[aria-label="Link"]');
    await input.fill(text);
  }

  it('says where a code with a logo breaks, in millimetres, and shows its weak spots', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await setLink(LINK);
    await driver.waitForText(VERIFIED);
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForText('Level H');
    await driver.waitForText(VERIFIED);
    await driver.waitForElement('section[aria-label="Where it breaks"]');

    const headline = await driver.execute<string>(
      `return document.querySelector('section[aria-label="Where it breaks"]').textContent;`,
    );
    expect(headline).toContain('Level H is said to survive 30 % damage.');
    expect(headline).toContain('With this logo,');
    expect(headline).toMatch(/one smudge \d+(\.\d)? mm across, in the right place, can stop it\./);
    expect(await driver.findAll('ul[aria-label="Error-correction blocks"] li')).toHaveLength(2);

    await (
      await driver.findByXPath(`${card}//label[normalize-space(.)="Show the weak spots"]`)
    ).click();
    await driver.waitForElement(
      'section[aria-label="Where it breaks"] figure svg[aria-hidden="true"] circle',
    );
    expect(await result()).toBe('Still guaranteed to read.');
    await scrollCardIntoView();
    await session.screenshot('breaks-light');
  });

  it('smudges the weakest spot: past its guarantee, and the decoder agrees it no longer reads', async () => {
    const { driver } = session;
    await clickInCard('Smudge the weakest spot');
    await waitForResult('the prediction', (t) => t.startsWith('Past its guarantee — block'));
    await clickInCard('Ask the decoder');
    const answer = await waitForResult(
      "the decoder's answer",
      (t) => t.includes('The decoder') && !t.includes('Asking the decoder'),
    );
    expect(answer).toMatch(/The decoder (found no code|read something else)\./);
    expect(
      (
        await driver.findAll(
          'section[aria-label="Where it breaks"] figure svg[aria-hidden="true"] rect',
        )
      ).length,
    ).toBeGreaterThan(5);
    await scrollDrawingIntoView();
    await session.screenshot('breaks-smudged-light');
    await session.driver.execute(
      `document.querySelector('section[aria-label="Where it breaks"] p[aria-live="polite"]').scrollIntoView({ block: "end" })`,
    );
    await session.screenshot('breaks-result-light');
  });

  it('a stroke drawn with the pointer over two modules stays guaranteed, and the decoder reads it', async () => {
    const { driver } = session;
    await clickInCard('Clear');
    await waitForResult('the cleared card', (t) => t === 'Still guaranteed to read.');
    await (
      await driver.findByXPath(`${card}//*[@role="radio" and normalize-space(.)="Ink"]`)
    ).click();
    await clickInCard('Draw');
    await scrollDrawingIntoView();

    const box = await overlay();
    expect(box?.side).toBe(SIZE + 2 * QUIET);
    if (box === null) return;
    const module = box.width / box.side;
    // Two light-or-dark data modules on the right edge, half way down: clear of the finders, the
    // timing, the alignment pattern at (22, 22) and the logo in the middle.
    const at = (x: number, y: number) => ({
      x: box.left + (x + QUIET + 0.5) * module,
      y: box.top + (y + QUIET + 0.5) * module,
    });
    await driver.drag([at(SIZE - 3, 14), at(SIZE - 2, 14)]);
    const painted = await driver.findAll(
      'section[aria-label="Where it breaks"] figure svg[aria-hidden="true"] rect',
    );
    expect(painted.length).toBeGreaterThanOrEqual(1);
    expect(painted.length).toBeLessThanOrEqual(2);

    await clickInCard('Draw');
    expect(await result()).toBe('Still guaranteed to read.');
    await clickInCard('Ask the decoder');
    const answer = await waitForResult(
      "the decoder's answer",
      (t) => t.includes('The decoder') && !t.includes('Asking the decoder'),
    );
    expect(answer).toBe('Still guaranteed to read. The decoder read it.');
  });

  it('the host refuses damage that is not on the code, and reads the code with none', async () => {
    const scene = await session.driver.execute<string>(
      'return document.querySelector("figure svg").outerHTML;',
    );
    const refused = await invoke('damage_test', {
      svg: scene,
      payload: LINK,
      pixel_size: 512,
      logo: null,
      modules: SIZE + 2 * QUIET,
      quiet_zone: QUIET,
      cells: [{ x: SIZE + QUIET, y: 0, dark: true }],
    });
    expect(refused).toHaveProperty('__error');

    const clean = await invoke<{ reads: boolean; decoder: string }>('damage_test', {
      svg: scene,
      payload: LINK,
      pixel_size: 512,
      logo: null,
      modules: SIZE + 2 * QUIET,
      quiet_zone: QUIET,
      cells: [],
    });
    expect(clean, JSON.stringify(clean)).toMatchObject({ reads: true });
    expect((clean as { decoder: string }).decoder).toMatch(/^rqrr \d+\.\d+\.\d+$/);
  });

  it('ink on a dark module changes nothing; paper on it counts, and a finder is left to the decoder', async () => {
    const { driver } = session;
    await clickInCard('Clear');
    await waitForResult('the cleared card', (t) => t === 'Still guaranteed to read.');
    await chooseBrush('Ink');
    await clickInCard('Draw');
    // The centre of the top-left finder is dark: ink there is painted, and changes nothing.
    await driver.drag([await pointOf(3, 3)]);
    expect(await damageShown()).toBe(1);
    expect(await result()).toBe('Still guaranteed to read.');

    await chooseBrush('Paper');
    await driver.drag([await pointOf(3, 3)]);
    await waitForResult('the finder sentence', (t) =>
      t.startsWith('A finder or the quiet zone was hit: only a decoder can say.'),
    );
    await clickInCard('Draw');
    await clickInCard('Ask the decoder');
    await waitForResult(
      "the decoder's answer",
      (t) => t.includes('The decoder') && !t.includes('Asking the decoder'),
    );
  });

  it('the weakest spot and the decoder can both be reached from the keyboard', async () => {
    const { driver } = session;
    await clickInCard('Clear');
    await waitForResult('the cleared card', (t) => t === 'Still guaranteed to read.');
    await driver.execute(
      `[...document.querySelectorAll('section[aria-label="Where it breaks"] button')]
         .find((b) => b.textContent.trim() === 'Smudge the weakest spot').focus();`,
    );
    await driver.chord(Keys.ENTER);
    await waitForResult('the prediction', (t) => t.startsWith('Past its guarantee — block'));
    // Draw, then Ask the decoder: the grid's own order.
    await driver.chord(Keys.TAB);
    await driver.chord(Keys.TAB);
    expect(await driver.execute<string>('return document.activeElement.textContent.trim();')).toBe(
      'Ask the decoder',
    );
    await driver.chord(Keys.ENTER);
    const answer = await waitForResult(
      "the decoder's answer",
      (t) => t.includes('The decoder') && !t.includes('Asking the decoder'),
    );
    expect(answer).toMatch(/The decoder (found no code|read something else)\./);
  });

  it('the preview and the file never carry the damage on the card', async () => {
    const { driver } = session;
    // The weakest spot is still smudged on the card, from the test before.
    expect(await damageShown()).toBeGreaterThan(5);
    const previews = await driver.execute<{ overlays: number; same: boolean }>(
      `const figures = [...document.querySelectorAll('figure')];
       const main = figures[0];
       const copy = document.querySelector('section[aria-label="Where it breaks"] figure');
       return {
         overlays: main.querySelectorAll('svg[aria-hidden="true"]').length,
         same: main !== copy && main.querySelector('svg').outerHTML === copy.querySelector('svg').outerHTML,
       };`,
    );
    expect(previews).toEqual({ overlays: 0, same: true });
    await driver.waitForText(VERIFIED);

    const damaged = await exportPixels('with-damage-on-the-card.png');
    expect(
      jsQR(new Uint8ClampedArray(damaged.png.data), damaged.png.width, damaged.png.height)?.data,
    ).toBe(LINK);

    await clickInCard('Clear');
    await waitForResult('the cleared card', (t) => t === 'Still guaranteed to read.');
    const clean = await exportPixels('with-nothing-on-the-card.png');
    // Every pixel the same: only the stamp, which is per file, tells the two files apart.
    expect(Buffer.compare(damaged.png.data, clean.png.data)).toBe(0);
  });

  it('a new code leaves the damage behind', async () => {
    const { driver } = session;
    await clickInCard('Smudge the weakest spot');
    await waitForResult('the prediction', (t) => t.startsWith('Past its guarantee'));
    await setLink('https://example.org/elsewhere');
    await driver.waitForText('Opens example.org');
    await driver.waitFor('the card on the new code, undamaged', async () => {
      return (await result()) === 'Still guaranteed to read.' && (await damageShown()) === 0;
    });
  });

  it('without a logo it says so, and the millimetres follow the printed size', async () => {
    const { driver } = session;
    await setLink(LINK);
    await driver.waitForText('Opens example.com');
    await (await driver.findByXPath('//button[normalize-space(.)="Remove"]')).click();
    const pattern =
      /Level [LMQH] is said to survive \d+ % damage — spread perfectly evenly\. One smudge (\d+\.\d) mm across, in the right place, can stop it\./;
    let at25 = 0;
    await driver.waitFor('the sentence without a logo', async () => {
      const found = pattern.exec(await cardText());
      if (found === null) return false;
      at25 = Number(found[1]);
      return true;
    });
    expect(await cardText()).not.toContain('With this logo');

    const setWidth = (value: string) =>
      driver.execute(
        `const input = document.querySelector('input[aria-label="Width"]');
         const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
         set.call(input, ${JSON.stringify(value)});
         input.dispatchEvent(new Event('input', { bubbles: true }));`,
      );
    await setWidth('50');
    let at50 = 0;
    await driver.waitFor('the sentence at 50 mm', async () => {
      const found = pattern.exec(await cardText());
      if (found === null) return false;
      at50 = Number(found[1]);
      return at50 !== at25;
    });
    // Twice the print, twice the smudge, to the sentence's one decimal.
    expect(Math.abs(at50 - 2 * at25)).toBeLessThanOrEqual(0.15);
    await setWidth('25');
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForText('Level H');
  });

  it('shows the same in the dark theme', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Create');
    await driver.waitForElement('section[aria-label="Where it breaks"]');
    await (
      await driver.findByXPath(`${card}//label[normalize-space(.)="Show the weak spots"]`)
    ).click();
    await clickInCard('Smudge the weakest spot');
    await waitForResult('the prediction', (t) => t.startsWith('Past its guarantee'));
    await scrollDrawingIntoView();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await session.screenshot('breaks-dark');
    await theme('Match Windows');
  });
});
