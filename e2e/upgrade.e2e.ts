import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * The installation everybody who has 1.0.0 will do: 1.1 opened on a workspace 1.0.0 wrote.
 *
 * The fixture is not made by this suite or by the current code. It was written by the real 1.0.0
 * binary, built from the `v1.0.0` tag and driven through its own screens: four saved codes (a link,
 * a link with a logo, a Wi-Fi with its password and one without), a logo and a brand kit. Its
 * verifications name the 1.0.0 decoder. A change that strands that workspace, or that makes one of
 * those codes rebuild differently, fails here.
 */

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'workspace-1.0.0.sqlite3',
);

interface Row {
  name: string;
}

describe('a workspace from 1.0.0', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession({ seedWorkspace: FIXTURE });
  });

  afterAll(async () => {
    await session?.stop();
  });

  const invoke = <T>(command: string, args: Record<string, unknown>) =>
    session.driver.executeAsync<T>(
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

  it('opens, and is migrated forward', async () => {
    const { driver } = session;
    await go('Diagnostics');
    await driver.waitForText('7 (up to date)');
  });

  it('keeps every saved code, logo and brand kit', async () => {
    const codes = await invoke<Row[]>('list_codes', {});
    expect(codes.map((c) => c.name).sort()).toEqual([
      'Menu with logo',
      'Office with password',
      'Office without password',
      'Plain link',
    ]);
    const logos = await invoke<Row[]>('list_logos', {});
    expect(logos.map((l) => l.name)).toEqual(['brand']);
    const kits = await invoke<Row[]>('list_brand_kits', {});
    expect(kits.map((k) => k.name)).toEqual(['House']);
  });

  it('checks every code again with the new decoder: all rebuild identically and read', async () => {
    const { driver } = session;
    await go('Library');
    await driver.waitForElement('ul[aria-label="Saved codes"]');
    await (await driver.findByXPath('//button[normalize-space(.)="Check all again"]')).click();
    const rows = () =>
      driver.execute<string[]>(
        `return [...document.querySelectorAll('ul[aria-label="Saved codes"] > li')].map((li) => li.textContent);`,
      );
    // The check runs one code at a time, so a row is read only once all four have their line.
    await driver.waitFor('a line on all four rows', async () =>
      (await rows()).every(
        (row) => row.includes('Rebuilds') || row.includes('reads') || row.includes('saved without'),
      ),
    );
    const lines = await rows();
    const line = (name: string) => lines.find((row) => row.includes(name)) ?? '';
    expect(line('Plain link'), lines.join(' | ')).toContain('Rebuilds identically and reads.');
    expect(line('Menu with logo'), lines.join(' | ')).toContain('Rebuilds identically and reads.');
    expect(line('Office with password'), lines.join(' | ')).toContain(
      'Rebuilds identically and reads.',
    );
    expect(line('Office without password'), lines.join(' | ')).toContain(
      'saved without its Wi-Fi password',
    );
    await session.screenshot('upgrade-recheck');
  });

  it('reopens a code with a logo exactly as 1.0.0 saved it, and verifies it', async () => {
    const { driver } = session;
    await (await driver.waitForElement('button[aria-label="Open Menu with logo"]')).click();
    await driver.waitForText('Reopened exactly as it was saved.');
    await driver.waitForText('read it back byte for byte');
    await driver.waitForElement('section[aria-label="Where it breaks"]');
  });
});
