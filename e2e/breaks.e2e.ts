import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  async function setLink(text: string): Promise<void> {
    const input = await session.driver.waitForElement('input[aria-label="Link"]');
    await input.clear();
    await input.sendKeys(' ');
    await input.sendKeys(Keys.BACKSPACE);
    await input.sendKeys(text);
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
    expect(headline).toMatch(/one smudge \d+(\.\d)? mm across, in the right place, stops it\./);
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

  it('shows the same in the dark theme', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Create');
    await driver.waitForElement('section[aria-label="Where it breaks"]');
    await clickInCard('Smudge the weakest spot');
    await waitForResult('the prediction', (t) => t.startsWith('Past its guarantee'));
    await scrollCardIntoView();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await session.screenshot('breaks-dark');
    await theme('Match Windows');
  });
});
