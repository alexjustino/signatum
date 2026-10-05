import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encodeText } from '../src/domain/qr/encode';
import { renderScene } from '../src/domain/scene';
import { startSession, type Session } from './session';

/**
 * P3's proof of done, against the real binary: a link through a shortener, a host that mixes
 * alphabets, and an IP address are each named in a sentence on Create, on Batch and on Read —
 * and nothing is refused: the export stays open and the code still verifies.
 */

const VERIFIED = 'read it back byte for byte';
const SHORT = 'https://bit.ly/3abc';
// "аpple" with a Cyrillic а: the label every look-alike guard is built for.
const LOOKALIKE = 'https://аpple.com/login';

type InvokeResult<T> = T | { __error: string };

describe('look-alike guard', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  const invoke = <T>(command: string, args: Record<string, unknown>) =>
    session.driver.executeAsync<InvokeResult<T>>(
      'const [command, args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

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

  /** A link typed through React's own setter: one change, not one per keystroke. */
  async function setLink(value: string): Promise<void> {
    await session.driver.waitForElement('input[aria-label="Link"]');
    await session.driver.execute(
      `const input = document.querySelector('input[aria-label="Link"]');
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(value)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
  }

  const exportOpen = async () =>
    (await (
      await session.driver.findByXPath('//button[contains(normalize-space(.), "Export PNG")]')
    ).attribute('disabled')) === null;

  it('names a shortener on Create, and leaves the export open', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await setLink(SHORT);
    await driver.waitForText('Check this address');
    await driver.waitForText('bit.ly is a link shortener');
    await driver.waitForText(VERIFIED);
    await driver.waitFor('the export open', exportOpen);
    await session.screenshot('lookalike-create-light');
  });

  it('names a label that mixes alphabets, and the word it imitates', async () => {
    const { driver } = session;
    await setLink(LOOKALIKE);
    await driver.waitForText('mixes Latin and Cyrillic letters');
    await driver.waitForText('it reads as “apple”, but it is a different address');
    await driver.waitForText(VERIFIED);
    expect(await exportOpen()).toBe(true);
  });

  it('says nothing about an ordinary link', async () => {
    const { driver } = session;
    await setLink('https://example.com/menu');
    await driver.waitForText(VERIFIED);
    await driver.waitForGone('Check this address');
  });

  it('lists the rows of a batch whose address is worth a second look', async () => {
    const { driver } = session;
    await go('Batch');
    const csv = [
      'name,url',
      'menu,https://example.com/menu',
      'short,https://bit.ly/x',
      'office,https://192.168.0.10/',
    ].join('\r\n');
    await driver.execute(
      `const box = document.querySelector('textarea[aria-label="Rows"]');
       const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
       setter.call(box, ${JSON.stringify(csv)});
       box.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
    await driver.waitForText('3 rows can be made.');
    const items = await driver.findAll('ul[aria-label="Addresses to check"] li');
    const texts = await Promise.all(items.map((i) => i.text()));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(/^Line 3: bit\.ly is a link shortener/);
    expect(texts[1]).toMatch(/^Line 4: 192\.168\.0\.10 is an address on a private network/);
    await driver.waitForText('check the address');
    await session.screenshot('lookalike-batch-light');
  });

  it('warns on Read before the address is followed', async () => {
    const { driver } = session;
    const svg = renderScene(encodeText(SHORT, 'M')).svg;
    const copied = await invoke<{ verified: boolean }>('copy_png', {
      svg,
      payload: SHORT,
      pixel_size: 512,
      logo: null,
      dpi: 300,
    });
    expect(copied, JSON.stringify(copied)).not.toHaveProperty('__error');
    await go('Read');
    await (await driver.findByXPath('//button[normalize-space(.)="Paste from clipboard"]')).click();
    await driver.waitForElement('[aria-label="Code 1"]');
    await driver.waitForText('Check this address before you open it');
    await driver.waitForText('bit.ly is a link shortener');
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('lookalike-read-light');
  });

  it('shows the warnings in the dark theme too', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Create');
    await setLink(LOOKALIKE);
    await driver.waitForText('mixes Latin and Cyrillic letters');
    await session.screenshot('lookalike-create-dark');
    await go('Read');
    await driver.waitForElement('[aria-label="Code 1"]');
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('lookalike-read-dark');
    await theme('Match Windows');
  });
});
