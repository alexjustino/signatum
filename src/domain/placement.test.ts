import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import {
  EC_BLOCKS,
  EC_CODEWORDS_PER_BLOCK,
  SAFETY,
  blockOfCodeword,
  checkBox,
  codewordMap,
  coverage,
  functionModules,
  hasCentreAlignment,
  knockOut,
  middleAlignmentCentre,
  largestBox,
  penalty,
  plateOf,
  planCode,
  rawDataModules,
} from './placement';
import { ECLS, encode, type Ecl, type Matrix } from './qr/encode';
import {
  alignmentCentres,
  checkFunctionPatterns,
  decodeFormat,
  readFormatBits,
  sizeOfVersion,
} from './qr/structure';

const QUIET = 4;

/** Rasterise a (possibly knocked-out) matrix with a white plate drawn where the logo would be. */
function decodeWithPlate(
  m: Matrix,
  plate: { x: number; y: number; width: number; height: number } | null,
  scale = 3,
): string | null {
  const side = (m.size + 2 * QUIET) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < m.size; y += 1) {
    for (let x = 0; x < m.size; x += 1) {
      if (m.modules[y]?.[x] !== true) continue;
      const sx = x + QUIET;
      const sy = y + QUIET;
      const underPlate =
        plate !== null &&
        sx >= plate.x &&
        sx < plate.x + plate.width &&
        sy >= plate.y &&
        sy < plate.y + plate.height;
      if (underPlate) continue;
      for (let py = 0; py < scale; py += 1) {
        for (let px = 0; px < scale; px += 1) {
          const i = (sy * scale + py) * side + sx * scale + px;
          data[i * 4] = 0;
          data[i * 4 + 1] = 0;
          data[i * 4 + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side)?.data ?? null;
}

describe('the tables and the maps', () => {
  it("leaves exactly the standard's data modules once the function patterns are excluded", () => {
    for (let v = 1; v <= 40; v += 1) {
      const map = functionModules(v);
      const free = map.flat().filter((f) => !f).length;
      expect(free, `v${v}`).toBe(rawDataModules(v));
    }
  });

  it('places every codeword in exactly eight modules and marks the remainder', () => {
    for (const v of [1, 2, 7, 14, 21, 40]) {
      const map = codewordMap(v);
      const counts = new Map<number, number>();
      let remainder = 0;
      for (const row of map) {
        for (const c of row) {
          if (c === -2) remainder += 1;
          else if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
      const rawCodewords = Math.floor(rawDataModules(v) / 8);
      expect(counts.size, `v${v}`).toBe(rawCodewords);
      expect(
        [...counts.values()].every((n) => n === 8),
        `v${v}`,
      ).toBe(true);
      expect(remainder, `v${v}`).toBe(rawDataModules(v) % 8);
    }
  });

  it('assigns every codeword to a block, and the blocks add up', () => {
    for (let v = 1; v <= 40; v += 1) {
      for (const ecl of ECLS) {
        const blocks = blockOfCodeword(v, ecl);
        const rawCodewords = Math.floor(rawDataModules(v) / 8);
        expect(blocks.length, `v${v} ${ecl}`).toBe(rawCodewords);
        const numBlocks = EC_BLOCKS[ecl][v] ?? 0;
        const sizes = Array<number>(numBlocks).fill(0);
        for (const b of blocks) sizes[b] = (sizes[b] ?? 0) + 1;
        const ecLen = EC_CODEWORDS_PER_BLOCK[ecl][v] ?? 0;
        // Every block is at least its error-correction codewords plus one data codeword.
        expect(Math.min(...sizes), `v${v} ${ecl}`).toBeGreaterThan(ecLen);
        expect(Math.max(...sizes) - Math.min(...sizes), `v${v} ${ecl}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('knows which versions put an alignment pattern in the middle', () => {
    // An odd number of alignment centres puts one in the middle: at the exact centre, or up to
    // four modules beside it where the standard's rounding shifts the row (version 22 is first).
    for (let v = 1; v <= 40; v += 1) {
      const expected = (v >= 7 && v <= 13) || (v >= 21 && v <= 27) || v >= 35;
      expect(hasCentreAlignment(v), `v${v}`).toBe(expected);
      const middle = middleAlignmentCentre(v);
      if (middle !== null) {
        expect(Math.abs(middle - (sizeOfVersion(v) - 1) / 2), `v${v}`).toBeLessThanOrEqual(4);
        expect(alignmentCentres(v)).toContain(middle);
      }
    }
    expect(middleAlignmentCentre(22)).toBe(50);
    expect(middleAlignmentCentre(7)).toBe(22);
  });
});

describe('the largest logo the engine allows', () => {
  it('covers no function pattern and still decodes, at Q and H, on every version that has room', () => {
    let checked = 0;
    for (let v = 2; v <= 40; v += 1) {
      for (const ecl of ['Q', 'H'] as Ecl[]) {
        const text = `v${v}${ecl}`;
        const matrix = encode(text, { ecl, minVersion: v, maxVersion: v, boostEcl: false });
        const largest = largestBox(v, ecl, 1, QUIET);
        if (largest === null) {
          // Only the smallest symbols have no room for even a five-module logo with its plate;
          // the planner moves such a code up a version.
          expect(v, `v${v} ${ecl} has no room`).toBeLessThanOrEqual(3);
          continue;
        }
        const plate = plateOf(largest.box, 1);
        expect(largest.coverage.touchesFunction).toBe(false);
        expect(largest.coverage.worst).toBeLessThanOrEqual(largest.coverage.budget);
        const knocked = knockOut(matrix, plate, QUIET);
        if (!hasCentreAlignment(v)) {
          expect(checkFunctionPatterns(knocked), `v${v} ${ecl} keeps its patterns`).toBeNull();
        }
        expect(decodeWithPlate(knocked, plate), `v${v} ${ecl} decodes`).toBe(text);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2 * 39 - 4);
  }, 240_000);

  it('with the exception off, refuses a plate over the centre alignment pattern', () => {
    expect(largestBox(7, 'H', 1, QUIET, SAFETY, false)).toBeNull();
    expect(largestBox(7, 'H', 1, QUIET, SAFETY, true)).not.toBeNull();
  });

  it('refuses one step over the budget with the reason', () => {
    const largest = largestBox(5, 'H', 1, QUIET);
    expect(largest).not.toBeNull();
    if (largest === null) return;
    const over = {
      ...largest.box,
      x: largest.box.x - 1,
      y: largest.box.y - 1,
      width: largest.box.width + 2,
      height: largest.box.height + 2,
    };
    const verdict = checkBox(5, 'H', over, 1, QUIET);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/budget|cannot lose/);
  });

  it('is exactly at the budget one step below', () => {
    const largest = largestBox(5, 'H', 1, QUIET);
    if (largest === null) throw new Error('version 5 at H has room for a logo');
    const cov = coverage(5, 'H', plateOf(largest.box, 1), QUIET);
    expect(cov.worst).toBeLessThanOrEqual(cov.budget);
    expect(cov.budget).toBe(
      Math.floor(Math.floor((EC_CODEWORDS_PER_BLOCK.H[5] ?? 0) / 2) * SAFETY),
    );
  });
});

describe('planCode', () => {
  it('without a logo it is the encoder at the level asked, raised only when that is free', () => {
    const plan = planCode('https://example.com/', { logo: false, ecl: 'M', quietZone: QUIET });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.box).toBeNull();
      expect(ECLS.indexOf(plan.ecl)).toBeGreaterThanOrEqual(ECLS.indexOf('M'));
      expect(plan.version).toBe(encode('https://example.com/', { ecl: 'M' }).version);
    }
  });

  it('with a logo it goes to level H and never to version 1', () => {
    const plan = planCode('a', { logo: true, quietZone: QUIET });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ecl).toBe('H');
    expect(plan.version).toBeGreaterThanOrEqual(2);
    expect(plan.box).not.toBeNull();
  });

  it('on the first version with a centre alignment pattern: covers it and reads, or jumps to 14', () => {
    // 64 bytes need version 7 at H (60 fit version 6, 64 is version 7's capacity).
    const text = 'https://example.com/' + 'x'.repeat(44);
    const natural = encode(text, { ecl: 'H', boostEcl: false });
    expect(natural.version).toBe(7);
    const covered = planCode(text, { logo: true, quietZone: QUIET });
    expect(covered.ok).toBe(true);
    if (covered.ok && covered.box !== null) {
      expect(covered.version).toBe(7);
      expect(decodeWithPlate(covered.matrix, plateOf(covered.box, 1))).toBe(text);
    }
    const strict = planCode(text, { logo: true, quietZone: QUIET, allowCentreAlignment: false });
    expect(strict.ok).toBe(true);
    if (strict.ok) expect(strict.version).toBe(14);
  });

  it('chooses the mask with the knock-out in place, and the format bits say so', () => {
    const plan = planCode('https://example.com/menu', { logo: true, quietZone: QUIET });
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.box === null) return;
    const bits = readFormatBits(plan.matrix);
    expect(decodeFormat(bits.first)).toEqual({ ecl: plan.ecl, mask: plan.mask });
    // The knocked-out plate is light, and the code still reads with the plate drawn.
    const plate = plateOf(plan.box, 1);
    for (let sy = plate.y; sy < plate.y + plate.height; sy += 1) {
      for (let sx = plate.x; sx < plate.x + plate.width; sx += 1) {
        expect(plan.matrix.modules[sy - QUIET]?.[sx - QUIET]).toBe(false);
      }
    }
    expect(decodeWithPlate(plan.matrix, plate)).toBe('https://example.com/menu');
    expect(penalty(plan.matrix.modules)).toBeGreaterThan(0);
  });

  it('takes a smaller share when asked, never a larger one', () => {
    const text = 'https://example.com/' + 'y'.repeat(150);
    const big = planCode(text, { logo: true, quietZone: QUIET });
    const small = planCode(text, { logo: true, quietZone: QUIET, fraction: 0.1 });
    const huge = planCode(text, { logo: true, quietZone: QUIET, fraction: 0.9 });
    if (!big.ok || !small.ok || !huge.ok) throw new Error('all three plans should succeed');
    expect(small.box?.width ?? 0).toBeLessThan(big.box?.width ?? 0);
    expect(huge.box?.width).toBe(big.box?.width);
  });

  it('refuses content that fits at L but not once the logo needs H or Q', () => {
    const text = 'x'.repeat(2000);
    expect(encode(text, { ecl: 'L' }).version).toBeLessThanOrEqual(40);
    const plan = planCode(text, { logo: true, quietZone: QUIET });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain('does not fit');
  });

  it('a symbol of size n has an odd side, so the box sits in the exact middle', () => {
    const plan = planCode('https://example.com/', { logo: true, quietZone: QUIET });
    if (!plan.ok || plan.box === null) throw new Error('expected a box');
    const centre = QUIET + sizeOfVersion(plan.version) / 2;
    expect(plan.box.x + plan.box.width / 2).toBe(centre);
  });
});
