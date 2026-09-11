import { emptyForm } from './payload';
import type { ContactForm } from './payload/contact';
import { describe, expect, it } from 'vitest';

import {
  MIN_MODULE_MM,
  NOMINAL_PRINT_MM,
  densityWarning,
  moduleSizeMm,
  DEFAULT_DENSITY_ADVICE,
  densityAdvice,
} from './density';

/** A symbol of version `v`, with the quiet zone the standard asks for on both sides. */
function sideOf(version: number, quietZone = 4): number {
  return 17 + 4 * version + 2 * quietZone;
}

describe('moduleSizeMm', () => {
  it('divides the printed width by the modules across it, quiet zone included', () => {
    expect(moduleSizeMm(50, 25)).toBe(0.5);
    expect(moduleSizeMm(100, 25)).toBe(0.25);
    expect(moduleSizeMm(sideOf(1), 25)).toBeCloseTo(0.862, 3);
  });

  it('answers zero rather than infinity for a size nobody can print', () => {
    expect(moduleSizeMm(0, 25)).toBe(0);
    expect(moduleSizeMm(-1, 25)).toBe(0);
    expect(moduleSizeMm(50, 0)).toBe(0);
    expect(moduleSizeMm(Number.NaN, 25)).toBe(0);
    expect(moduleSizeMm(50, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('densityWarning', () => {
  it('assumes the nominal print size when none is given', () => {
    expect(densityWarning({ side: 81 })).toBe(densityWarning({ side: 81 }, NOMINAL_PRINT_MM));
    expect(NOMINAL_PRINT_MM).toBe(25);
  });

  it('says nothing about a code whose modules are half a millimetre or more', () => {
    expect(moduleSizeMm(50, NOMINAL_PRINT_MM)).toBe(MIN_MODULE_MM);
    expect(densityWarning({ side: 50 })).toBeNull();
    expect(densityWarning({ side: 49 })).toBeNull();
  });

  it('warns as soon as they are smaller, and says how small', () => {
    expect(densityWarning({ side: 51 })).toBe(
      "At 25 mm this code's modules are 0.49 mm — too small for most cameras. " +
        'Print it larger, or shorten the content.',
    );
    expect(densityWarning({ side: 81 })).toBe(
      "At 25 mm this code's modules are 0.31 mm — too small for most cameras. " +
        'Print it larger, or shorten the content.',
    );
  });

  it('never warns about a version-1 code at 25 mm — the smallest code there is', () => {
    expect(densityWarning({ side: sideOf(1) })).toBeNull();
    expect(densityWarning({ side: sideOf(1, 0) })).toBeNull();
    // Nor about the versions a short payload reaches: at 25 mm the line falls between
    // version 6 (0.51 mm a module) and version 7 (0.47 mm).
    expect(densityWarning({ side: sideOf(5) })).toBeNull();
    expect(densityWarning({ side: sideOf(6) })).toBeNull();
    expect(densityWarning({ side: sideOf(7) })).toContain('0.47 mm');
  });

  it('warns about the versions a full contact card reaches', () => {
    expect(densityWarning({ side: sideOf(20) })).toContain('0.24 mm');
    expect(densityWarning({ side: sideOf(40) })).toContain('0.14 mm');
  });

  it('rounds the number it shows to two decimals', () => {
    expect(densityWarning({ side: 81 })).toContain('0.31 mm');
    expect(densityWarning({ side: 64 })).toContain('0.39 mm');
    expect(densityWarning({ side: 60 })).toContain('0.42 mm');
  });

  it('never claims that half a millimetre is less than half a millimetre', () => {
    // 0.499 mm rounds to 0.50, and a warning that reads as its own counter-example is worse
    // than no warning: the decision is taken on the number the sentence shows.
    expect(moduleSizeMm(100, 49.9)).toBeLessThan(MIN_MODULE_MM);
    expect(densityWarning({ side: 100 }, 49.9)).toBeNull();
    expect(densityWarning({ side: 100 }, 49)).toContain('0.49 mm');
  });

  it('says the print size the way a person writes it', () => {
    expect(densityWarning({ side: 185 }, 12.5)).toBe(
      "At 12.5 mm this code's modules are 0.07 mm — too small for most cameras. " +
        'Print it larger, or shorten the content.',
    );
    expect(densityWarning({ side: 185 }, 20)).toContain('At 20 mm');
  });

  it('says nothing about a size that cannot be printed', () => {
    expect(densityWarning({ side: 0 })).toBeNull();
    expect(densityWarning({ side: 29 }, 0)).toBeNull();
    expect(densityWarning({ side: Number.NaN })).toBeNull();
  });

  it('is a sentence, and it ends like one', () => {
    const warning = densityWarning({ side: 105 }) ?? '';
    expect(warning).toMatch(/^\S.*\.$/);
  });
});

describe('densityAdvice', () => {
  it('suggests MECARD only to a card that is not one yet', () => {
    const card = emptyForm('contact') as ContactForm;
    expect(densityAdvice(card)).toBe('Use MECARD, or fewer fields.');
    expect(densityAdvice({ ...card, format: 'mecard' })).toBe('Use fewer fields.');
    expect(densityAdvice(emptyForm('text'))).toBe(DEFAULT_DENSITY_ADVICE);
    expect(densityWarning({ side: 100 }, 25, densityAdvice(emptyForm('link')))).toContain(
      'Print it larger',
    );
  });
});
