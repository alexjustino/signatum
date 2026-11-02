import { describe, expect, it } from 'vitest';

import { plateOf } from '@/domain/placement';
import { headroom, weakestSpot, type BlockBudget, type Prediction } from '@/domain/resilience';

import {
  blockLabel,
  decoderFailure,
  decoderLine,
  headline,
  LEVEL_FIGURE,
  millimetresPerModule,
  predictionLine,
  spotDiameterMm,
} from './breakSentences';
import { PLATE_PADDING, planFor } from './plan';

const BLOCK: BlockBudget = { capacity: 11, logo: 6, damage: 0, spare: 5, length: 35 };

function prediction(verdict: Prediction['verdict'], blocks: BlockBudget[] = [BLOCK]): Prediction {
  return { blocks, weakest: 0, structural: 0, quietZone: 0, verdict };
}

describe('the figures behind the sentence', () => {
  it('measures a module across the whole printed width, quiet zone included', () => {
    // 25 mm over 29 modules and a 4-module margin on each side: 37 modules across.
    expect(millimetresPerModule(25, 29, 4)).toBeCloseTo(25 / 37, 10);
  });

  it('makes a smudge one module wider than twice its radius', () => {
    expect(spotDiameterMm(0, 0.5)).toBeCloseTo(0.5, 10);
    expect(spotDiameterMm(3, 0.5)).toBeCloseTo(3.5, 10);
  });

  it('quotes the conventional figure for every level', () => {
    expect(LEVEL_FIGURE).toEqual({ L: 7, M: 15, Q: 25, H: 30 });
  });
});

describe('headline', () => {
  const base = { ecl: 'H' as const, widthMm: 25, size: 29, quietZone: 4 };

  it('sets what the logo left against the quoted figure, and names the smudge in millimetres', () => {
    // radius √10 → (2√10 + 1) × 25/37 = 4.948… mm.
    expect(headline({ ...base, afterLogo: 0.143, hasLogo: true, spotRadius: Math.sqrt(10) })).toBe(
      'Level H is said to survive 30 % damage. With this logo, 14 % is left if damage is spread ' +
        'evenly — and one smudge 4.9 mm across, in the right place, can stop it.',
    );
  });

  it('qualifies the claim instead when there is no logo', () => {
    expect(
      headline({ ...base, ecl: 'M', afterLogo: 0.15, hasLogo: false, spotRadius: Math.sqrt(10) }),
    ).toBe(
      'Level M is said to survive 15 % damage — spread perfectly evenly. One smudge 4.9 mm ' +
        'across, in the right place, can stop it.',
    );
  });

  it('drops the smudge when there is no spot to name', () => {
    expect(headline({ ...base, afterLogo: 0.2, hasLogo: true, spotRadius: null })).toBe(
      'Level H is said to survive 30 % damage. With this logo, 20 % is left if damage is spread evenly.',
    );
    expect(headline({ ...base, ecl: 'L', afterLogo: 0.07, hasLogo: false, spotRadius: null })).toBe(
      'Level L is said to survive 7 % damage — spread perfectly evenly.',
    );
  });

  it('says the measured case of the decision record: 14 % left, 4.9 mm can stop it at 25 mm', () => {
    const plan = planFor('https://example.com/menu', {
      logoSize: 'largest',
      quietZone: 4,
      ecl: undefined,
    });
    if (!plan.ok || plan.box === null) throw new Error('the measured case must plan with a logo');
    const plate = plateOf(plan.box, PLATE_PADDING);
    const spot = weakestSpot(plan.matrix, plate, 4);
    const figures = headroom(plan.matrix, plate, 4);
    expect(
      headline({
        ecl: plan.matrix.ecl,
        afterLogo: figures.afterLogo,
        hasLogo: true,
        spotRadius: spot?.radius ?? null,
        widthMm: 25,
        size: plan.matrix.size,
        quietZone: 4,
      }),
    ).toBe(
      'Level H is said to survive 30 % damage. With this logo, 14 % is left if damage is spread ' +
        'evenly — and one smudge 4.9 mm across, in the right place, can stop it.',
    );
  });
});

describe('blockLabel', () => {
  it('counts blocks from one and says what is spent of what can be corrected', () => {
    expect(blockLabel(1, BLOCK)).toBe('Block 2 — 6 of 11 spent');
  });

  it('counts the damage with the logo, and past the capacity when it is', () => {
    expect(blockLabel(0, { ...BLOCK, damage: 6, spare: -1 })).toBe('Block 1 — 12 of 11 spent');
  });
});

describe('predictionLine', () => {
  it('says a code within every budget is still guaranteed', () => {
    expect(predictionLine(prediction('guaranteed'))).toBe('Still guaranteed to read.');
  });

  it('names the block past its guarantee, counted from one', () => {
    const blocks = [BLOCK, { ...BLOCK, damage: 6, spare: -1 }];
    expect(predictionLine({ ...prediction('past-guarantee', blocks), weakest: 1 })).toBe(
      'Past its guarantee — block 2 has lost 12 of the 11 codewords it can correct.',
    );
  });

  it('leaves a hit finder or quiet zone to the decoder', () => {
    expect(predictionLine(prediction('decoder-decides'))).toBe(
      'A finder or the quiet zone was hit: only a decoder can say.',
    );
  });
});

describe('decoderLine', () => {
  it('says the decoder read it', () => {
    expect(decoderLine({ reads: true, reason: null }, 'guaranteed', true)).toBe(
      'The decoder read it.',
    );
    expect(decoderLine({ reads: true, reason: null }, 'decoder-decides', false)).toBe(
      'The decoder read it.',
    );
  });

  it('explains a read past the guarantee by what the logo covers', () => {
    expect(decoderLine({ reads: true, reason: null }, 'past-guarantee', true)).toBe(
      'The decoder still read it: some of what the logo covers survived better than the ' +
        'guarantee counts.',
    );
  });

  it('does not blame a logo that is not there', () => {
    expect(decoderLine({ reads: true, reason: null }, 'past-guarantee', false)).toBe(
      'The decoder still read it, past its guarantee.',
    );
  });

  it("says a failure in the host's own sentence", () => {
    expect(
      decoderLine({ reads: false, reason: 'The decoder read something else.' }, 'guaranteed', true),
    ).toBe('The decoder read something else.');
    expect(decoderLine({ reads: false, reason: null }, 'past-guarantee', true)).toBe(
      'The decoder found no code.',
    );
  });

  it('never words a host that could not be asked as an answer', () => {
    expect(decoderFailure('The host did not answer.')).toBe(
      'The decoder could not be asked. The host did not answer.',
    );
  });
});
