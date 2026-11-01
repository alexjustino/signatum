import { describe, expect, it } from 'vitest';

import { codewordMap } from '@/domain/placement';
import { encode } from '@/domain/qr/encode';
import type { BlockBudget } from '@/domain/resilience';

import { blockPaths, cellAt, spentStep } from './weakSpots';

const QUIET = 4;

/** How many module squares a path traces. */
function squares(path: string): number {
  return path.split('M').length - 1;
}

describe('blockPaths', () => {
  const matrix = encode('https://example.com/menu', { ecl: 'H' });

  it('traces every data module once, in scene modules, one path per block', () => {
    const paths = blockPaths(matrix, null, QUIET);
    const data = codewordMap(matrix.version)
      .flat()
      .filter((c) => c >= 0).length;
    expect(paths.reduce((sum, path) => sum + squares(path), 0)).toBe(data);
    // Version 3-H interleaves two blocks.
    expect(paths).toHaveLength(2);
    // The bottom-right module is data and lands at (size − 1 + quiet zone) in the scene.
    const corner = `M${matrix.size - 1 + QUIET} ${matrix.size - 1 + QUIET}h1v1h-1z`;
    expect(paths.some((path) => path.includes(corner))).toBe(true);
  });

  it('leaves the modules under the plate out', () => {
    const open = blockPaths(matrix, null, QUIET);
    const plate = { x: QUIET + 10, y: QUIET + 10, width: 9, height: 9 };
    const covered = blockPaths(matrix, plate, QUIET);
    const total = (paths: string[]) => paths.reduce((sum, path) => sum + squares(path), 0);
    expect(total(covered)).toBeLessThan(total(open));
    expect(covered.join('')).not.toContain(`M${QUIET + 14} ${QUIET + 14}h1`);
  });
});

describe('spentStep', () => {
  const block = (spare: number, capacity = 12): BlockBudget => ({
    capacity,
    logo: capacity - spare,
    damage: 0,
    spare,
    length: 30,
  });

  it('ramps from a block with its budget intact to one with none', () => {
    expect(spentStep(block(12))).toBe('low');
    expect(spentStep(block(8))).toBe('low');
    expect(spentStep(block(6))).toBe('mid');
    expect(spentStep(block(2))).toBe('high');
    expect(spentStep(block(0))).toBe('high');
  });

  it('treats a block past its guarantee as fully spent', () => {
    expect(spentStep(block(-3))).toBe('high');
  });
});

describe('cellAt', () => {
  const box = { left: 100, top: 50, width: 370, height: 370 };

  it('snaps a point to the module under it, in symbol coordinates', () => {
    // 37 scene modules across 370 px: 10 px a module. (145, 95) is scene module (4, 4).
    expect(cellAt({ x: 145, y: 95 }, box, 37, QUIET)).toEqual({ x: 0, y: 0 });
    expect(cellAt({ x: 469, y: 419 }, box, 37, QUIET)).toEqual({ x: 32, y: 32 });
  });

  it('reaches into the quiet zone as negative coordinates', () => {
    expect(cellAt({ x: 101, y: 51 }, box, 37, QUIET)).toEqual({ x: -4, y: -4 });
  });

  it('says nothing about a point outside the scene', () => {
    expect(cellAt({ x: 99, y: 60 }, box, 37, QUIET)).toBeNull();
    expect(cellAt({ x: 470, y: 60 }, box, 37, QUIET)).toBeNull();
    expect(cellAt({ x: 120, y: 60 }, { ...box, width: 0 }, 37, QUIET)).toBeNull();
  });
});
