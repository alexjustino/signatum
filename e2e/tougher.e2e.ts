import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * P10's proof of done, against the real binary: "Make it tougher" offers only changes that ask for
 * a larger smudge, each one uses the control a person would have used, and the code that results
 * passes the gate and is measured again.
 *
 * - A link carrying campaign parameters is offered without them: the code drops several versions,
 *   the link field holds the cleaned link, and the parameters it kept are still there.
 * - A short link with a logo, where every logo size is the same code, is offered only a larger
 *   print, and using it sets the printed width.
 * - Without a logo, a higher level is offered once, and using it sets the Look card's level.
 */

const VERIFIED = 'read it back byte for byte';
const CAMPAIGN =
  'https://example.com/menu?table=12&utm_source=flyer&utm_medium=print&utm_campaign=summer-2026';
const CLEANED = 'https://example.com/menu?table=12';
const MENU = 'https://example.com/menu';

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

describe('make it tougher', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-tougher-'));
    session = await startSession();
    const file = path.join(dir, 'brand.png');
    await writeFile(file, redSquarePng());
    const info = await session.driver.executeAsync<{ id: string } | { __error: string }>(
      'const [args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke("import_logo", args).then(done, (e) => done({ __error: String(e) }));',
      [{ path: file }],
    );
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
  });

  afterAll(async () => {
    await session?.stop();
    await rm(dir, { recursive: true, force: true });
  });

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
    await go('Create');
  }

  async function setLink(text: string): Promise<void> {
    await (await session.driver.waitForElement('input[aria-label="Link"]')).fill(text);
  }

  /** "Now: version 9, level H — …": the version the code on screen has. */
  const nowLine = () =>
    session.driver.execute<string>(
      `const card = document.querySelector('section[aria-label="Where it breaks"]');
       const p = card && [...card.querySelectorAll('p')].find((x) => x.textContent.startsWith('Now:'));
       return p ? p.textContent : '';`,
    );

  const versionNow = async () => Number(/version (\d+)/.exec(await nowLine())?.[1] ?? NaN);

  const rows = () =>
    session.driver.execute<string[]>(
      `return [...document.querySelectorAll('ul[aria-label="Ways to make it tougher"] > li')].map((li) => li.dataset.key);`,
    );

  async function waitForNow(what: string, test: (line: string) => boolean): Promise<string> {
    let last = '';
    await session.driver.waitFor(what, async () => {
      last = await nowLine();
      return test(last);
    });
    return last;
  }

  const use = async (label: string) => {
    await (await session.driver.waitForElement(`button[aria-label="Use: ${label}"]`)).click();
  };

  /** The accessible name of whatever has the focus now. */
  const focused = () =>
    session.driver.execute<string | null>(
      `return document.activeElement ? document.activeElement.getAttribute('aria-label') : null;`,
    );

  const scrollTougherIntoView = () =>
    session.driver.execute(
      `const ul = document.querySelector('ul[aria-label="Ways to make it tougher"]') ||
         document.querySelector('section[aria-label="Where it breaks"]');
       ul.scrollIntoView({ block: "center" });`,
    );

  it('offers a campaign link without its tracking parameters, and the code gets smaller', async () => {
    const { driver } = session;
    await theme('Light');
    await setLink(CAMPAIGN);
    await driver.waitForText(VERIFIED);
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForText('Level H');
    await driver.waitForText(VERIFIED);
    await waitForNow('the measured code', (line) => line.startsWith('Now: version'));
    const before = await versionNow();
    expect(await rows()).toContain('tracking');
    await scrollTougherIntoView();
    await session.screenshot('tougher-light');

    await use('Without its tracking parameters (utm_source, utm_medium, utm_campaign)');
    await driver.waitFor(
      'the cleaned link in the field',
      async () =>
        (await driver.execute<string>(
          `return document.querySelector('input[aria-label="Link"]').value;`,
        )) === CLEANED,
    );
    // The card went away while the gate asked again; the focus went to the field that changed.
    await driver.waitFor('the focus on the link', async () => (await focused()) === 'Link');
    await driver.waitForText(VERIFIED);
    await waitForNow('the smaller code', (line) => line.startsWith('Now: version'));
    expect(await versionNow()).toBeLessThan(before);
    expect(await rows()).not.toContain('tracking');
  });

  it('on a short link with a logo offers only a larger print, and sets the width', async () => {
    const { driver } = session;
    await setLink(MENU);
    await driver.waitForText('Opens example.com');
    await driver.waitForText(VERIFIED);
    await waitForNow('the short code', (line) => line.includes('4.9 mm'));
    expect(await rows()).toEqual(['print']);
    await use('Printed 30 mm wide');
    await driver.waitFor(
      'the width set to 30',
      async () =>
        (await driver.execute<string>(
          `return document.querySelector('input[aria-label="Width"]').value;`,
        )) === '30',
    );
    await driver.waitFor('the focus on the width', async () => (await focused()) === 'Width');
    await driver.waitForText(VERIFIED);
    await waitForNow('the larger print', (line) => line.includes('5.9 mm'));
  });

  it('without a logo offers a higher level once, and sets the Look card’s level', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Remove"]')).click();
    await driver.waitForText(VERIFIED);
    await waitForNow('the code without a logo', (line) => line.includes('level M'));
    const keys = await rows();
    expect(keys.filter((k) => k.startsWith('level-'))).toEqual(['level-Q']);
    await use('At least Q');
    await driver.waitFor(
      'the level set',
      async () =>
        (await driver.execute<string>(
          `return document.querySelector('select[aria-label="Error correction"]').value;`,
        )) === 'Q',
    );
    await driver.waitFor(
      'the focus on the level',
      async () => (await focused()) === 'Error correction',
    );
    await driver.waitForText(VERIFIED);
    await waitForNow('the higher level', (line) => !line.includes('level M'));
  });

  it('shows the same in the dark theme', async () => {
    const { driver } = session;
    await theme('Dark');
    await setLink(CAMPAIGN);
    await driver.waitForText(VERIFIED);
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForText(VERIFIED);
    await driver.waitFor('the rows', async () => (await rows()).includes('tracking'));
    await scrollTougherIntoView();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await session.screenshot('tougher-dark');
    await theme('Match Windows');
  });
});
