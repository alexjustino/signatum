import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * F11's settings, against the real binary: the defaults a person sets survive a restart and are
 * what the Create screen starts from; the theme is kept in the workspace rather than the
 * browser's storage; a key the host does not keep, or a value that does not fit, is a sentence.
 */

type InvokeResult<T> = T | { __error: string };

describe('settings', () => {
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

  async function typeInto(label: string, value: string): Promise<void> {
    const field = await session.driver.waitForElement(`input[aria-label="${label}"]`);
    await field.clear();
    await field.sendKeys(' ');
    await field.sendKeys(Keys.BACKSPACE);
    await field.sendKeys(value);
  }

  /** A number field set through React's own setter: a controlled input ignores WebDriver's clear. */
  async function setNumber(label: string, value: string): Promise<void> {
    await session.driver.waitForElement(`input[aria-label="${label}"]`);
    await session.driver.execute(
      `const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(value)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
  }

  const themeOnScreen = () =>
    session.driver.execute<string | null>(
      'return document.documentElement.getAttribute("data-theme")',
    );

  it('keeps the theme and the defaults a person sets', async () => {
    const { driver } = session;
    await go('Settings');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Dark"]')
    ).click();
    await driver.waitFor('the dark theme', async () => (await themeOnScreen()) === 'dark');

    await setNumber('Default width', '40');
    await setNumber('Default resolution', '600');
    await setNumber('Default quiet zone', '2');
    await driver.waitFor(
      'the three defaults written',
      async () =>
        JSON.stringify(await invoke('settings_get', { key: 'default_quiet_zone' })) ===
        JSON.stringify({ value: '2' }),
    );
    await driver.waitForText('Saved.');
    await (
      await driver.findByXPath('//label[normalize-space(.)="Keep Wi-Fi passwords in saved codes"]')
    ).click();
    await driver.waitFor(
      'the setting written',
      async () =>
        JSON.stringify(await invoke('settings_get', { key: 'keep_wifi_passwords' })) ===
        JSON.stringify({ value: 'false' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await session.screenshot('settings-defaults-dark');

    const all = await invoke<Array<{ key: string; value: string }>>('settings_all', {});
    const map = Object.fromEntries(
      (all as Array<{ key: string; value: string }>).map((s) => [s.key, s.value]),
    );
    expect(map, JSON.stringify(map)).toMatchObject({
      theme: 'dark',
      default_width_mm: '40',
      default_dpi: '600',
      default_quiet_zone: '2',
      keep_wifi_passwords: 'false',
    });
  });

  it('after a restart the theme and the defaults are what was set', async () => {
    // The browser's own storage is only a mirror: emptied here, so the theme that comes back can
    // only have come from the workspace table.
    await session.driver.execute('window.localStorage.clear();');
    await session.restart();
    const { driver } = session;
    await driver.waitForElement('input[aria-label="Link"]');
    expect(await themeOnScreen()).toBe('dark');
    expect(await invoke('settings_get', { key: 'theme' })).toEqual({ value: 'dark' });
    // A controlled input carries its value as a property, not an attribute.
    const valueOf = (selector: string) =>
      driver.execute<string | null>(
        `const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.value : null;`,
      );
    await driver.waitForElement('input[aria-label="Width"]');
    expect(await valueOf('input[aria-label="Width"]')).toBe('40');
    expect(await valueOf('select[aria-label="Resolution"]')).toBe('600');
  });

  it('the Save form starts from the Wi-Fi password default', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab" and normalize-space(.)="Wi-Fi"]')).click();
    await typeInto('Network name', 'Office-5G');
    await typeInto('Password', 'hunter2hunter2');
    await driver.waitFor('a fresh verdict', async () => {
      const button = await driver.findByXPath(
        '//button[contains(normalize-space(.), "Export PNG")]',
      );
      return (await button.attribute('disabled')) === null;
    });
    await (await driver.findByXPath('//button[normalize-space(.)="Save…"]')).click();
    await driver.waitForElement('input[aria-label="Name"]');
    const kept = await driver.execute<boolean | null>(
      `const box = document.querySelector('input[aria-label="Save the password with this code"]'); return box ? box.checked : null;`,
    );
    expect(kept).toBe(false);
    await driver.chord(Keys.ESCAPE);
  });

  it('refuses a key the host does not keep, and a value that does not fit', async () => {
    const unknown = await invoke('settings_set', { key: 'anything', value: 'x' });
    expect(unknown).toHaveProperty('__error');
    expect((unknown as { __error: string }).__error).toContain('not a setting');
    const wide = await invoke('settings_set', { key: 'default_width_mm', value: '5000' });
    expect(wide).toHaveProperty('__error');
    expect((wide as { __error: string }).__error).toMatch(/1000/);
    const theme = await invoke('settings_set', { key: 'theme', value: 'sepia' });
    expect(theme).toHaveProperty('__error');
  });

  it('the settings screen in the light theme', async () => {
    const { driver } = session;
    await go('Settings');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Light"]')
    ).click();
    await driver.waitFor('the light theme', async () => (await themeOnScreen()) === 'light');
    // The colour transition is 100 ms; a capture inside it is a grey nobody sees.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await session.screenshot('settings-defaults-light');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();
  });
});
