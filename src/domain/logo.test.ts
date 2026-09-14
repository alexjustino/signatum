import { describe, expect, it } from 'vitest';

import { LOGO_SIZE_LABELS, LOGO_SIZES, PLATES, PLATE_LABELS, logoFraction } from './logo';

describe('the plate', () => {
  it('names every shape', () => {
    for (const plate of PLATES) expect(PLATE_LABELS[plate].length).toBeGreaterThan(0);
  });
});

describe('logoFraction', () => {
  it('names every size', () => {
    for (const size of LOGO_SIZES) expect(LOGO_SIZE_LABELS[size].length).toBeGreaterThan(0);
  });

  it('asks for no share at all for the largest — the budget decides that one', () => {
    expect(logoFraction('largest')).toBeUndefined();
  });

  it('asks for less than the largest, and medium for more than small', () => {
    const medium = logoFraction('medium');
    const small = logoFraction('small');
    expect(medium).toBeDefined();
    expect(small).toBeDefined();
    expect(small ?? 1).toBeLessThan(medium ?? 0);
    expect(medium ?? 1).toBeLessThan(1);
    expect(small ?? 0).toBeGreaterThan(0);
  });
});
