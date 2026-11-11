import { describe, expect, it } from 'vitest';

import {
  MAX_PROOF_MM,
  PROOF_SIZES_MM,
  proofFileName,
  proofSizes,
  readingDistanceCm,
} from './proof';
import { pixelsFor } from './size';

describe('proofSizes', () => {
  it('carries the four standard sizes, and the chosen one when it is none of them', () => {
    const plan = proofSizes({ value: 40, unit: 'mm', dpi: 300 });
    expect(plan.sizes.map((s) => s.mm)).toEqual([15, 20, 25, 30, 40]);
    expect(plan.sizes.filter((s) => s.chosen).map((s) => s.mm)).toEqual([40]);
    expect(plan.note).toBeNull();
  });

  it('does not repeat the chosen size when it is a standard one, and marks it', () => {
    const plan = proofSizes({ value: 25, unit: 'mm', dpi: 300 });
    expect(plan.sizes.map((s) => s.mm)).toEqual([...PROOF_SIZES_MM]);
    expect(plan.sizes.find((s) => s.chosen)?.mm).toBe(25);
  });

  it('renders each size with exactly the pixels an export of that size would have', () => {
    for (const dpi of [150, 300, 600, 1200]) {
      for (const size of proofSizes({ value: 25, unit: 'mm', dpi }).sizes) {
        expect(size.pixelSize).toBe(pixelsFor({ value: size.mm, unit: 'mm', dpi }));
      }
    }
    expect(
      proofSizes({ value: 25, unit: 'mm', dpi: 300 }).sizes.find((s) => s.mm === 25)?.pixelSize,
    ).toBe(295);
  });

  it('takes a size in inches as its millimetres', () => {
    const plan = proofSizes({ value: 1.5, unit: 'in', dpi: 300 });
    expect(plan.sizes.find((s) => s.chosen)?.mm).toBe(38.1);
  });

  it('keeps a size the resolution cannot render, and says why in its box', () => {
    // 15 mm at 72 dpi would be 43 pixels; the host renders from 64.
    const plan = proofSizes({ value: 25, unit: 'mm', dpi: 72 });
    const fifteen = plan.sizes.find((s) => s.mm === 15);
    expect(fifteen?.refused).toMatch(/^At 72 dpi, 15 mm is 43 pixels — too few to render/);
    expect(plan.sizes.find((s) => s.mm === 25)?.refused).toBeNull();
  });

  it('refuses a size that would be more pixels than a code is rendered at', () => {
    const plan = proofSizes({ value: 100, unit: 'mm', dpi: 1200 });
    expect(plan.sizes.find((s) => s.mm === 100)?.refused).toMatch(
      /more than a code is rendered at/,
    );
  });

  it('leaves a chosen size wider than A4 off the sheet, and says so', () => {
    const plan = proofSizes({ value: MAX_PROOF_MM + 10, unit: 'mm', dpi: 150 });
    expect(plan.sizes.map((s) => s.mm)).toEqual([...PROOF_SIZES_MM]);
    expect(plan.sizes.some((s) => s.chosen)).toBe(false);
    expect(plan.note).toMatch(/^The chosen 200 mm is wider than an A4 page can hold/);
  });
});

describe('readingDistanceCm', () => {
  it('is ten times the width, in centimetres', () => {
    expect(readingDistanceCm(25)).toBe(25);
    expect(readingDistanceCm(12.5)).toBe(13);
  });
});

describe('proofFileName', () => {
  it('names the sheet after the code, made safe as a file name', () => {
    expect(proofFileName('Menu')).toBe('Menu-proof.pdf');
    expect(proofFileName('a/b:c')).toBe('a-b-c-proof.pdf');
    expect(proofFileName('  ')).toBe('signatum-proof.pdf');
    expect(proofFileName(null)).toBe('signatum-proof.pdf');
  });
});
