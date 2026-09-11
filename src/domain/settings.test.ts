import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, readTheme, THEMES, THEME_LABELS } from './settings';

describe('readTheme', () => {
  it.each(THEMES)('keeps %s, which this build knows', (choice) => {
    expect(readTheme(choice)).toBe(choice);
  });

  it('falls back to the default when nothing was stored', () => {
    expect(readTheme(null)).toBe(DEFAULT_THEME);
    expect(readTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it.each([['midnight'], [''], ['Dark'], [' dark ']])(
    'falls back for %o, which is not a choice',
    (raw) => {
      expect(readTheme(raw)).toBe(DEFAULT_THEME);
    },
  );

  it('falls back for a value that is not a string at all', () => {
    expect(readTheme(2)).toBe(DEFAULT_THEME);
    expect(readTheme({ theme: 'dark' })).toBe(DEFAULT_THEME);
    expect(readTheme(['dark'])).toBe(DEFAULT_THEME);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => readTheme(Symbol('dark'))).not.toThrow();
  });
});

describe('the labels', () => {
  it('names every choice, so no option is drawn from its id', () => {
    for (const choice of THEMES) {
      expect(THEME_LABELS[choice]).toBeTruthy();
    }
  });
});
