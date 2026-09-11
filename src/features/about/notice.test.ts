import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { thirdParty } from './notice';

/**
 * The About screen reads its credits from NOTICE, so there is exactly one list
 * of what this product is built on rather than two that drift.
 *
 * These tests guard the seam. A silent parse failure would show an empty
 * credits list to every user while the file it was meant to read sits there,
 * correct, on disk — the kind of bug nobody reports because it looks
 * intentional.
 */

const NOTICE = readFileSync(join(process.cwd(), 'NOTICE'), 'utf8');

describe('reading the credits from NOTICE', () => {
  const credits = thirdParty(NOTICE);

  it('finds the third-party list that actually ships', () => {
    expect(credits.length).toBeGreaterThan(5);
  });

  it('gives every entry a name and a licence', () => {
    for (const credit of credits) {
      expect(credit.name).not.toBe('');
      expect(credit.licence).not.toBe('');
      // The dot leaders are for a human reading the file, not for the screen.
      expect(credit.name).not.toContain('.....');
      expect(credit.licence).not.toContain('.....');
    }
  });

  it('reads the components the product is actually built on', () => {
    const names = credits.map((credit) => credit.name);
    expect(names).toContain('Tauri');
    expect(names).toContain('React, React DOM');
    expect(names).toContain('Fluent UI System Icons');
    expect(names).toContain('rusqlite / SQLite');
  });

  it('lists what the product actually depends on today', () => {
    // The screen shows this to a person, so a stale NOTICE is not a paperwork
    // problem — it is the product telling somebody something untrue. The list
    // fell behind once already, and this test is why it will not again.
    const names = credits.map((credit) => credit.name).join(' ');
    for (const dependency of ['Tauri', 'React', 'TanStack Query', 'Tailwind CSS', 'SQLite']) {
      expect(names, `NOTICE does not mention ${dependency}`).toContain(dependency);
    }
  });

  it('keeps the licence identifiers intact', () => {
    const tauri = credits.find((credit) => credit.name === 'Tauri');
    expect(tauri?.licence).toBe('Apache-2.0 OR MIT');
  });

  it('reads nothing rather than guessing when the section is missing', () => {
    expect(thirdParty('a file with no such section')).toEqual([]);
    expect(thirdParty('')).toEqual([]);
  });

  it('ignores the prose around the list', () => {
    const names = credits.map((credit) => credit.name);
    expect(names.some((name) => name.includes('Copyright'))).toBe(false);
    expect(names.some((name) => name.includes('TRADEMARK'))).toBe(false);
  });
});

describe('NOTICE says what the licence requires it to say', () => {
  it('names the copyright holder', () => {
    expect(NOTICE).toContain('Copyright 2026 Alex Justino');
  });

  it('carries the trademark statement', () => {
    // Apache-2.0 §6 grants no right to the project's name. The file says so
    // explicitly, which is the whole reason this licence was chosen over MIT.
    expect(NOTICE).toContain('trademark of Alex Justino');
  });

  it("carries the other owner's trademark, in full", () => {
    // "QR Code" is DENSO WAVE's, not ours, and About shows these two sentences
    // word for word. They are read from here, so the file and the screen cannot
    // drift apart on the one statement a lawyer would read first.
    expect(NOTICE).toContain('"QR Code" is a registered trademark of DENSO WAVE INCORPORATED');
    expect(NOTICE).toContain('affiliated with or endorsed by DENSO WAVE');
  });
});
