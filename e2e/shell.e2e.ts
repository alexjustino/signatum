import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * The shell: the window comes up, the rail names every destination, and each
 * one renders a real screen. This is the first thing that must be true of a
 * build before any other claim about it means anything.
 */
describe('shell', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens on Create with the title bar and the mark', async () => {
    const { driver } = session;
    expect(await driver.title()).toBe('Signatum');
    await driver.waitForElement('input[aria-label="Link"]');
    const mark = await driver.find('header img');
    expect(await mark.attribute('width')).toBe('16');
  });

  it('lists every destination', async () => {
    const { driver } = session;
    const buttons = await driver.findAll('nav[aria-label="Main"] button');
    const labels = await Promise.all(buttons.map((b) => b.text()));
    expect(labels).toEqual(['Create', 'Library', 'Batch', 'Diagnostics', 'Settings', 'About']);
  });

  it.each([
    ['Library', 'h1'],
    ['Batch', 'h1'],
    ['Settings', 'h1'],
    ['Diagnostics', 'h1'],
    ['About', 'h1'],
    ['Create', 'input[aria-label="Link"]'],
  ])('navigates to %s and renders it', async (label, marker) => {
    const { driver } = session;
    const button = await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`);
    await button.click();
    await driver.waitForElement(marker);
    const current = await driver.findByXPath('//nav//button[@aria-current="page"]');
    expect(await current.text()).toBe(label);
  });

  it('Diagnostics reports the workspace the suite relocated it to', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Diagnostics"]')).click();
    const row = await driver.waitForText('signatum.sqlite3');
    expect(await row.text()).toContain(session.dataDir.split('\\').pop() ?? session.dataDir);
    await driver.waitForText('up to date');
    await driver.waitForText('relocated by SIGNATUM_DATA_DIR');
    await session.screenshot('diagnostics-light');
  });

  it('About carries both trademark statements', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="About"]')).click();
    await driver.waitForText('DENSO WAVE');
    await driver.waitForText('trademark of Alex Justino');
    await session.screenshot('about-light');
  });

  it('renders in the dark theme too', async () => {
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
    await session.screenshot('shell-dark');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();
  });
});
