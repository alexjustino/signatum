import type { LogoBox } from '@/domain/logo';
import { blockOfCodeword, codewordMap } from '@/domain/placement';
import type { BlockBudget } from '@/domain/resilience';
import type { Matrix } from '@/domain/qr/encode';

/**
 * The geometry of the weak-spot overlay (P9): which modules belong to which error-correction
 * block, how strongly a block is tinted, and which module a pointer is over.
 *
 * Pure, and kept beside the card rather than in it, because the overlay is drawn from these
 * numbers and a wrong one would put a tint on the wrong block with nothing on screen to say so.
 */

/**
 * One SVG path per block, tracing the data modules the block owns outside the logo plate, in
 * scene modules (the symbol starts at `quietZone`). A path per block rather than a rectangle per
 * module: a large code has tens of thousands of modules and a handful of blocks, and the tint is
 * a property of the block.
 */
export function blockPaths(matrix: Matrix, plate: LogoBox | null, quietZone: number): string[] {
  const codewords = codewordMap(matrix.version);
  const blocks = blockOfCodeword(matrix.version, matrix.ecl);
  const count = blocks.reduce((max, b) => Math.max(max, b + 1), 0);
  const paths = Array.from({ length: count }, () => [] as string[]);
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      const c = codewords[y]?.[x];
      if (c === undefined || c < 0) continue;
      const sx = x + quietZone;
      const sy = y + quietZone;
      if (
        plate !== null &&
        sx >= plate.x &&
        sx < plate.x + plate.width &&
        sy >= plate.y &&
        sy < plate.y + plate.height
      ) {
        continue;
      }
      const b = blocks[c];
      if (b !== undefined) paths[b]?.push(`M${sx} ${sy}h1v1h-1z`);
    }
  }
  return paths.map((parts) => parts.join(''));
}

/** The three steps of the tint, from a block with most of its budget left to one with none. */
export type SpentStep = 'low' | 'mid' | 'high';

/**
 * How spent a block is, quantised to three steps: a ramp a glance can tell apart beats a smooth
 * one it cannot. A block past its guarantee is as spent as a block can be.
 */
export function spentStep(block: BlockBudget): SpentStep {
  if (block.capacity <= 0) return 'high';
  // In whole codewords rather than as a share: 8 left of 12 is a third spent, exactly, and a
  // floating-point third is not.
  const spent = block.capacity - Math.max(0, block.spare);
  if (spent * 3 <= block.capacity) return 'low';
  if (spent * 3 <= block.capacity * 2) return 'mid';
  return 'high';
}

/**
 * The module under a pointer, in symbol coordinates — the overlay's box is the scene's
 * `side × side` square, so a share of the box is a share of the scene. Null outside the scene,
 * which a captured pointer dragged past the edge can be.
 */
export function cellAt(
  point: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  side: number,
  quietZone: number,
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const sx = Math.floor(((point.x - box.left) / box.width) * side);
  const sy = Math.floor(((point.y - box.top) / box.height) * side);
  if (sx < 0 || sy < 0 || sx >= side || sy >= side) return null;
  return { x: sx - quietZone, y: sy - quietZone };
}
