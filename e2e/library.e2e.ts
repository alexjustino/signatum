import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * F8's proof of done, against the real binary: a saved code reopens after a restart with the
 * identical scene; a brand kit applied to a new link gives the same look; deleting a logo used
 * by a kit says which kits. And the Wi-Fi password is stored only when the person keeps it.
 */

const LINK = 'https://example.com/menu';
const VERIFIED = 'read it back byte for byte';
const INK = '#1a2b3c';

type InvokeResult<T> = T | { __error: string };

interface SavedCode {
  id: string;
  name: string;
  kind: string;
  payload_json: string;
  scene_sha256: string;
}

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

/** The colours and the plate of a scene — its look — with the modules and the viewBox out. */
function lookOf(svg: string | null): string {
  const fills = [...(svg ?? '').matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  // The background is a `<rect width= height=>` with no position; a plate is a positioned
  // `<rect x= y=>` or a `<circle cx=>`, drawn after the modules.
  const plate = /<rect x="|<circle cx="/.test((svg ?? '').replace(/<path d="[^"]*"[^>]*>/, ''));
  return `${[...new Set(fills)].sort().join(',')}|plate=${plate}`;
}

describe('library', () => {
  let session: Session;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'signatum-library-'));
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

  const go = async (label: string) => {
    await (
      await session.driver.findByXPath(
        `//nav[@aria-label="Main"]//button[normalize-space(.)="${label}"]`,
      )
    ).click();
  };

  const clickText = async (text: string) => {
    await (await session.driver.findByXPath(`//button[normalize-space(.)="${text}"]`)).click();
  };

  async function typeInto(label: string, value: string): Promise<void> {
    const field = await session.driver.waitForElement(`input[aria-label="${label}"]`);
    await field.clear();
    await field.sendKeys(' ');
    await field.sendKeys(Keys.BACKSPACE);
    await field.sendKeys(value);
  }

  async function setColour(label: string, hex: string): Promise<void> {
    await session.driver.execute(
      `const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(hex)});
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
    );
  }

  async function choose(label: string, option: string): Promise<void> {
    await session.driver.execute(
      `const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]');
       const opt = [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(option)});
       const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
       setter.call(select, opt.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
    );
  }

  /** A verdict about the scene now on screen: the export button is enabled by nothing else. */
  async function verifiedNow(): Promise<void> {
    await session.driver.waitFor('a fresh verdict', async () => {
      const button = await session.driver.findByXPath(
        '//button[contains(normalize-space(.), "Export PNG")]',
      );
      return (await button.attribute('disabled')) === null;
    });
  }

  let savedScene: string | null = null;

  it('saves a verified code under a name', async () => {
    const { driver } = session;
    await typeInto('Link', LINK);
    await driver.waitForText(VERIFIED);
    savedScene = await sceneOnScreen();
    await clickText('Save…');
    await typeInto('Name', 'Menu');
    await clickText('Save code');
    await driver.waitForText('Saved as Menu');
    await session.screenshot('library-saved');
  });

  it('after a restart the library lists it, and it reopens exactly as it was', async () => {
    await session.restart();
    const { driver } = session;
    await go('Library');
    await driver.waitForElement('ul[aria-label="Saved codes"]');
    await driver.waitForText('Menu');
    await session.screenshot('library-light');
    await (await driver.waitForElement('button[aria-label="Open Menu"]')).click();
    await driver.waitForText('Reopened exactly as it was saved.');
    await verifiedNow();
    expect(await sceneOnScreen()).toBe(savedScene);
    const codes = await invoke<SavedCode[]>('list_codes', {});
    expect((codes as SavedCode[]).map((c) => c.name)).toEqual(['Menu']);
  });

  it('a brand kit applied to a new link gives the same look', async () => {
    const { driver } = session;
    const logoFile = path.join(dir, 'brand.png');
    await writeFile(logoFile, redSquarePng());
    const info = await invoke<{ id: string }>('import_logo', { path: logoFile });
    expect(info, JSON.stringify(info)).not.toHaveProperty('__error');
    await (await driver.waitForElement('button[aria-label="Use brand"]')).click();
    await driver.waitForElement('figure img');
    await setColour('Code colour', INK);
    await driver.waitFor('the ink on screen', async () =>
      ((await sceneOnScreen()) ?? '').includes(INK),
    );
    await verifiedNow();
    const branded = lookOf(await sceneOnScreen());
    expect(branded).toContain(INK);
    expect(branded).toContain('plate=true');

    await clickText('Save as brand kit…');
    await typeInto('Kit name', 'House');
    await clickText('Save kit');
    await driver.waitForText('Saved the brand kit House');

    // A fresh code with the plain look, then the kit in one click.
    await clickText('Reset look');
    await clickText('Remove');
    await typeInto('Link', 'https://example.org/');
    await driver.waitFor('the plain look', async () => {
      const svg = (await sceneOnScreen()) ?? '';
      return svg.includes('#000000') && !svg.includes(INK);
    });
    await choose('Apply a brand kit', 'House');
    await driver.waitFor(
      'the kit applied',
      async () =>
        ((await sceneOnScreen()) ?? '').includes(INK) &&
        (await driver.execute<boolean>('return document.querySelector("figure img") !== null;')),
    );
    await verifiedNow();
    expect(lookOf(await sceneOnScreen())).toBe(branded);
    await session.screenshot('library-kit');
  });

  it('forgetting a logo a kit uses says which kit, and keeps it', async () => {
    const { driver } = session;
    await (await driver.waitForElement('button[aria-label="Forget brand"]')).click();
    await driver.waitForText('used by the brand kit "House"');
    const logos = await invoke<Array<{ name: string }>>('list_logos', {});
    expect((logos as Array<{ name: string }>).some((l) => l.name === 'brand')).toBe(true);
  });

  it('shows the library in the dark theme, then deletes a saved code through the dialog', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Dark"]')
    ).click();
    await driver.waitFor(
      'the dark theme',
      async () =>
        (await driver.execute<string | null>(
          'return document.documentElement.getAttribute("data-theme")',
        )) === 'dark',
    );
    await go('Library');
    await driver.waitForElement('ul[aria-label="Saved codes"]');
    await driver.waitForText('Menu');
    await session.screenshot('library-dark');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();

    await go('Library');
    await (await driver.waitForElement('button[aria-label="Delete Menu"]')).click();
    await driver.waitForElement('[role="dialog"]');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Delete"]')
    ).click();
    await driver.waitForGone('Delete Menu');
    await driver.waitForText('Nothing saved yet');
    const codes = await invoke<SavedCode[]>('list_codes', {});
    expect((codes as SavedCode[]).map((c) => c.name)).not.toContain('Menu');
    await go('Create');
  });

  it('keeps a Wi-Fi password only when the person keeps it', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab" and normalize-space(.)="Wi-Fi"]')).click();
    await typeInto('Network name', 'Office-5G');
    await typeInto('Password', 'hunter2hunter2');
    await verifiedNow();
    await clickText('Save…');
    await typeInto('Name', 'Office');
    // The checkbox's <input> is visually hidden (a real control under a drawn one), so the
    // suite clicks its visible label and reads the state back from the input itself.
    await (
      await driver.findByXPath('//label[normalize-space(.)="Save the password with this code"]')
    ).click();
    await driver.waitFor(
      'the password left out',
      async () =>
        (await driver.execute<boolean>(
          `const box = document.querySelector('input[aria-label="Save the password with this code"]'); return box ? box.checked === false : false;`,
        )) === true,
    );
    await clickText('Save code');
    await driver.waitForText('Saved as Office');
    const codes = await invoke<SavedCode[]>('list_codes', {});
    const office = (codes as SavedCode[]).find((c) => c.name === 'Office');
    expect(office).toBeDefined();
    const saved = await invoke<SavedCode>('get_code', { id: office?.id });
    const form = JSON.parse((saved as SavedCode).payload_json) as {
      password: string;
      ssid: string;
    };
    expect(form.ssid).toBe('Office-5G');
    expect(form.password).toBe('');
  });
});
