import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * P5's proof of done, against the real binary: one press rebuilds every saved code, compares it
 * with the scene it was saved as and verifies it again, with progress; a code that rebuilds
 * differently is named, and so is a Wi-Fi code that cannot be rebuilt because it was saved
 * without its password.
 *
 * The drifted code is made with the product's own `save_code`, from the fields of a code the
 * screen saved, with a scene digest that is not the one those fields make — what a newer renderer
 * drawing the same fields differently would leave behind.
 */

const VERIFIED = 'read it back byte for byte';

type InvokeResult<T> = T | { __error: string };

interface SavedCode {
  id: string;
  name: string;
  kind: string;
  payload_json: string;
  style_json: string;
  size_json: string;
  logo_id: string | null;
  logo_json: string | null;
  scene_sha256: string;
}

describe('library, checked again', () => {
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

  it('saves a code from the screen, and leaves a drifted copy and a Wi-Fi code without its password', async () => {
    const { driver } = session;
    await theme('Light');
    await go('Create');
    await typeInto('Link', 'https://example.com/menu');
    await driver.waitForText(VERIFIED);
    await clickText('Save…');
    await typeInto('Name', 'Menu');
    await clickText('Save code');
    await driver.waitForText('Saved as Menu');

    const codes = (await invoke<SavedCode[]>('list_codes', {})) as SavedCode[];
    const menu = (await invoke<SavedCode>('get_code', { id: codes[0]?.id })) as SavedCode;
    const drifted = await invoke('save_code', {
      name: 'Drifted',
      kind: menu.kind,
      payload_json: menu.payload_json,
      style_json: menu.style_json,
      size_json: menu.size_json,
      logo_id: null,
      logo_json: null,
      scene_sha256: '0'.repeat(64),
    });
    expect(drifted, JSON.stringify(drifted)).not.toHaveProperty('__error');
    const office = await invoke('save_code', {
      name: 'Office',
      kind: 'wifi',
      payload_json: JSON.stringify({
        kind: 'wifi',
        ssid: 'Office-5G',
        password: '',
        security: 'WPA',
        hidden: false,
      }),
      style_json: menu.style_json,
      size_json: menu.size_json,
      logo_id: null,
      logo_json: null,
      scene_sha256: menu.scene_sha256,
    });
    expect(office, JSON.stringify(office)).not.toHaveProperty('__error');
  });

  it('checks every saved code again, with progress, and names the one that drifted', async () => {
    const { driver } = session;
    await go('Library');
    await driver.waitForElement('ul[aria-label="Saved codes"]');
    await clickText('Check all again');
    await driver.waitForText('rebuilds differently');
    await driver.waitForText('Rebuilds identically and reads.');
    await driver.waitForText(
      'Rebuilds differently from when it was saved, and still reads — check it before you print.',
    );
    await driver.waitForText('saved without its Wi-Fi password');
    await session.screenshot('recheck-light');
  });

  it('shows the check in the dark theme too', async () => {
    const { driver } = session;
    await theme('Dark');
    await go('Library');
    await clickText('Check all again');
    await driver.waitForText('rebuilds differently');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.screenshot('recheck-dark');
    await theme('Match Windows');
  });
});
