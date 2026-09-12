import { describe, expect, it } from 'vitest';

import {
  FINDER_SHAPES,
  FINDER_SHAPE_LABELS,
  MIN_CONTRAST,
  MODULE_SHAPES,
  MODULE_SHAPE_LABELS,
  checkContrast,
  contrastRatio,
  isInverted,
  luminance,
  quietZoneWarning,
} from './style';

describe('contrast', () => {
  it('is 21 between black and white, and 1 between a colour and itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });

  it('matches the WCAG reference values', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBe(0);
    // #767676 on white is the well-known 4.54:1 boundary.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('accepts black on white and refuses colours one step under the threshold', () => {
    expect(checkContrast({ foreground: '#000000', background: '#ffffff' })).toMatchObject({
      ok: true,
    });
    // #767676 passes; #777777 is one step lighter and fails.
    expect(checkContrast({ foreground: '#767676', background: '#ffffff' }).ok).toBe(true);
    const under = checkContrast({ foreground: '#777777', background: '#ffffff' });
    expect(under.ok).toBe(false);
    if (!under.ok) {
      expect(under.ratio).toBeLessThan(MIN_CONTRAST);
      expect(under.reason).toContain('too close');
      expect(under.reason).toContain('4.5');
    }
  });

  it('refuses inverted colours with a sentence, even at full contrast', () => {
    const inverted = checkContrast({ foreground: '#ffffff', background: '#000000' });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.reason).toContain('lighter than its background');
    expect(isInverted({ foreground: '#ffffff', background: '#000000' })).toBe(true);
    expect(isInverted({ foreground: '#000000', background: '#ffffff' })).toBe(false);
  });

  it('refuses a colour that is not six-digit hex', () => {
    expect(() => luminance('white')).toThrow();
    expect(() => contrastRatio('#fff', '#000000')).toThrow();
  });
});

describe('the quiet zone', () => {
  it('is silent at the standard and speaks under it', () => {
    expect(quietZoneWarning(4)).toBeNull();
    expect(quietZoneWarning(8)).toBeNull();
    expect(quietZoneWarning(2)).toContain('under 4 modules');
    expect(quietZoneWarning(0)).toContain('no quiet zone');
  });
});

describe('the shapes', () => {
  it('are named, and named once', () => {
    for (const s of MODULE_SHAPES) expect(MODULE_SHAPE_LABELS[s].length).toBeGreaterThan(0);
    for (const s of FINDER_SHAPES) expect(FINDER_SHAPE_LABELS[s].length).toBeGreaterThan(0);
  });
});
