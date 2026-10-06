import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * P6's proof of done, against the real binary: a code found by Read is matched against the
 * saved codes by what it carries — "Matches your saved code Menu", with Open — and Open takes the
 * person to that saved code, reopened exactly as it was.
 */

const LINK = 'https://example.com/menu';
const VERIFIED = 'read it back byte for byte';

type InvokeResult<T> = T | { __error: string };

describe('a print against the library', () => {
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

  async function typeInto(label: string, value: string): Promise<void> {
    const field = await session.driver.waitForElement(`input[aria-label="${label}"]`);
    await field.clear();
    await field.sendKeys(' ');
    await field.sendKeys(Keys.BACKSPACE);
    await field.sendKeys(value);
  }

  const clickText = async (text: string) => {
    await (await session.driver.findByXPath(`//button[normalize-space(.)="${text}"]`)).click();
  };

  it('saves a code, then reads it back from the clipboard and names the saved code it is', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await typeInto('Link', LINK);
    await driver.waitForText(VERIFIED);
    await clickText('Save…');
    await typeInto('Name', 'Menu');
    await clickText('Save code');
    await driver.waitForText('Saved as Menu');

    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    const copied = await invoke('copy_png', {
      svg,
      payload: LINK,
      pixel_size: 512,
      logo: null,
      dpi: 300,
    });
    expect(copied, JSON.stringify(copied)).not.toHaveProperty('__error');

    await go('Read');
    await clickText('Paste from clipboard');
    await driver.waitForElement('[aria-label="Code 1"]');
    await driver.waitForText('Matches your saved code Menu');
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('match-read-light');
  });

  it('opens the saved code it matched', async () => {
    const { driver } = session;
    await (
      await driver.findByXPath(
        '//*[@aria-label="Code 1"]//button[normalize-space(.)="Open" or @aria-label="Open Menu"]',
      )
    ).click();
    await driver.waitForText('Reopened exactly as it was saved.');
    const link = await driver.execute<string | null>(
      `const i = document.querySelector('input[aria-label="Link"]'); return i ? i.value : null;`,
    );
    expect(link).toBe(LINK);
  });

  it('says nothing when the code read is not in the library', async () => {
    const { driver } = session;
    await typeInto('Link', 'https://example.org/elsewhere');
    await driver.waitFor('the export open', async () => {
      const button = await driver.findByXPath(
        '//button[contains(normalize-space(.), "Export PNG")]',
      );
      return (await button.attribute('disabled')) === null;
    });
    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    await invoke('copy_png', {
      svg,
      payload: 'https://example.org/elsewhere',
      pixel_size: 512,
      logo: null,
      dpi: 300,
    });
    await go('Read');
    await clickText('Paste from clipboard');
    await driver.waitForText('Opens example.org');
    await driver.waitForGone('Matches your saved code');
  });

  it('shows the match in the dark theme too', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Create');
    await typeInto('Link', LINK);
    await driver.waitForText('Opens example.com');
    await driver.waitFor('the export open', async () => {
      const button = await driver.findByXPath(
        '//button[contains(normalize-space(.), "Export PNG")]',
      );
      return (await button.attribute('disabled')) === null;
    });
    const svg = await driver.execute<string | null>(
      'const svg = document.querySelector("figure svg"); return svg ? svg.outerHTML : null;',
    );
    await invoke('copy_png', { svg, payload: LINK, pixel_size: 512, logo: null, dpi: 300 });
    await go('Read');
    await clickText('Paste from clipboard');
    await driver.waitForText('Matches your saved code Menu');
    await driver.execute(
      `document.querySelector('[aria-label="Code 1"]').scrollIntoView({ block: "start" })`,
    );
    await session.screenshot('match-read-dark');
    await theme('Match Windows');
  });
});
