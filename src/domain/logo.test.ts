import { describe, expect, it } from 'vitest';

import { MIN_LOGO_MODULES, PLATES, PLATE_LABELS, centredLogoBox } from './logo';

describe('centredLogoBox', () => {
  it('is an odd square in the exact middle of the symbol', () => {
    const box = centredLogoBox({ size: 25 }, 4);
    expect(box.width).toBe(box.height);
    expect(box.width % 2).toBe(1);
    // Centre of the box = centre of the symbol, in scene coordinates.
    expect(box.x + box.width / 2).toBe(4 + 25 / 2);
    expect(box.y + box.height / 2).toBe(4 + 25 / 2);
  });

  it('takes a fifth of the side by default, and never less than five modules', () => {
    expect(centredLogoBox({ size: 21 }, 4).width).toBe(MIN_LOGO_MODULES);
    expect(centredLogoBox({ size: 57 }, 4).width).toBe(11);
    expect(centredLogoBox({ size: 177 }, 4).width).toBe(35);
  });

  it('never reaches the finders, whatever the fraction', () => {
    const box = centredLogoBox({ size: 21 }, 0, 0.99);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(21 - 8);
  });

  it('refuses a fraction that is not one', () => {
    expect(() => centredLogoBox({ size: 21 }, 4, 0)).toThrow();
    expect(() => centredLogoBox({ size: 21 }, 4, 1)).toThrow();
  });

  it('names every plate', () => {
    for (const plate of PLATES) expect(PLATE_LABELS[plate].length).toBeGreaterThan(0);
  });
});
