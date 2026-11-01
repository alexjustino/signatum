/**
 * How much damage a code can take, and where it is weakest (ADR-037).
 *
 * "Level H survives 30 % damage" is what every QR tool says, and it is true only of damage spread
 * perfectly evenly. Reed–Solomon corrects each error-correction block on its own: a code fails
 * the moment any one block loses more codewords than half its error-correction codewords, and a
 * logo has already spent part of every block it sits on. So a code has a weakest place, and a
 * smudge there stops it long before 30 % of anything is gone.
 *
 * This module answers three questions from the matrix alone, with the standard's arithmetic and
 * no decoder:
 *
 * - `blockBudgets` — what each block can still lose once the logo has taken its share;
 * - `predictDamage` — given modules changed by a scratch or a blot, whether the code is still
 *   guaranteed to read;
 * - `weakestSpot` — the smallest round smudge, anywhere on the symbol, that takes the code past
 *   its guarantee.
 *
 * The guarantee runs one way. Codewords under the logo plate are counted as lost, because what is
 * drawn there is a picture and not the code, so "guaranteed to read" is a promise and "past its
 * guarantee" is not a sentence of death: some of what the plate covers may have survived, and
 * only a decoder can say. The screen therefore asks the decoder as well, and shows both answers.
 *
 * Damage to a function pattern — a finder, the timing, the format or version information — is
 * not arithmetic: whether a decoder still finds the symbol depends on the decoder. It is counted
 * and named, never predicted.
 */

import type { LogoBox } from './logo';
import {
  EC_BLOCKS,
  EC_CODEWORDS_PER_BLOCK,
  blockOfCodeword,
  codewordMap,
  correctablePerBlock,
  functionModules,
  rawDataModules,
} from './placement';
import type { Ecl, Matrix } from './qr/encode';

/** One module changed by damage, in symbol coordinates (the quiet zone is not counted). */
export interface Damage {
  x: number;
  y: number;
  /** What the damage leaves there: ink (`true`) or bare paper (`false`). */
  dark: boolean;
}

/** One error-correction block, before and after damage. */
export interface BlockBudget {
  /** Codewords the block can lose and still be corrected: half its error-correction codewords. */
  capacity: number;
  /** Codewords already lost to the logo plate. */
  logo: number;
  /** Codewords lost to the damage, beyond those the plate already took. */
  damage: number;
  /** What is left: `capacity − logo − damage`. Below zero, the block is past its guarantee. */
  spare: number;
  /** Data and error-correction codewords in the block. */
  length: number;
}

/** The answer to "is it still guaranteed to read?". */
export interface Prediction {
  blocks: BlockBudget[];
  /** The block with the least spare. */
  weakest: number;
  /** Function modules (finders, timing, format, version, alignment) the damage changed. */
  structural: number;
  /** Damaged modules that fell outside the symbol, in the quiet zone. */
  quietZone: number;
  /**
   * `guaranteed` — every block is within its capacity and nothing structural changed.
   * `past-guarantee` — at least one block lost more than it can correct.
   * `decoder-decides` — the blocks are within capacity, but a function pattern or the quiet zone
   * was touched, and only a decoder can say whether the symbol is still found.
   */
  verdict: 'guaranteed' | 'past-guarantee' | 'decoder-decides';
}

/** The smallest round smudge that takes the code past its guarantee. */
export interface WeakestSpot {
  /** Its centre, in symbol coordinates (a module's centre is at `x + 0.5`). */
  x: number;
  y: number;
  /** Its radius, in modules. */
  radius: number;
  /** The block it pushes past capacity. */
  block: number;
  /** The modules it covers, in symbol coordinates. */
  cells: { x: number; y: number }[];
}

/** The figures a person can compare with "30 %". */
export interface Headroom {
  /** The share of all codewords the code could lose if damage were spread perfectly evenly. */
  textbook: number;
  /** The same, after the logo: what is left, spread evenly. */
  afterLogo: number;
  /** The share of the symbol's modules the weakest spot covers. */
  weakestShare: number;
}

interface Layout {
  n: number;
  codewords: number[][];
  blocks: number[];
  isFunction: boolean[][];
  capacity: number;
  lengths: number[];
  numBlocks: number;
}

function layoutOf(version: number, ecl: Ecl): Layout {
  const numBlocks = EC_BLOCKS[ecl][version] ?? 0;
  const blocks = blockOfCodeword(version, ecl);
  const lengths = Array<number>(numBlocks).fill(0);
  for (const b of blocks) lengths[b] = (lengths[b] ?? 0) + 1;
  return {
    n: 17 + 4 * version,
    codewords: codewordMap(version),
    blocks,
    isFunction: functionModules(version),
    capacity: correctablePerBlock(version, ecl),
    lengths,
    numBlocks,
  };
}

/** The codewords a plate covers, in scene modules with the symbol starting at `quietZone`. */
function plateCodewords(layout: Layout, plate: LogoBox | null, quietZone: number): Set<number> {
  const lost = new Set<number>();
  if (plate === null) return lost;
  for (let sy = plate.y; sy < plate.y + plate.height; sy += 1) {
    for (let sx = plate.x; sx < plate.x + plate.width; sx += 1) {
      const c = layout.codewords[sy - quietZone]?.[sx - quietZone];
      if (c !== undefined && c >= 0) lost.add(c);
    }
  }
  return lost;
}

function underPlate(plate: LogoBox | null, quietZone: number, x: number, y: number): boolean {
  if (plate === null) return false;
  const sx = x + quietZone;
  const sy = y + quietZone;
  return (
    sx >= plate.x && sx < plate.x + plate.width && sy >= plate.y && sy < plate.y + plate.height
  );
}

function budgets(layout: Layout, logo: Set<number>, damaged: Set<number>): BlockBudget[] {
  const fromLogo = Array<number>(layout.numBlocks).fill(0);
  const fromDamage = Array<number>(layout.numBlocks).fill(0);
  for (const c of logo) {
    const b = layout.blocks[c];
    if (b !== undefined) fromLogo[b] = (fromLogo[b] ?? 0) + 1;
  }
  for (const c of damaged) {
    if (logo.has(c)) continue;
    const b = layout.blocks[c];
    if (b !== undefined) fromDamage[b] = (fromDamage[b] ?? 0) + 1;
  }
  return fromLogo.map((l, b) => {
    const d = fromDamage[b] ?? 0;
    return {
      capacity: layout.capacity,
      logo: l,
      damage: d,
      spare: layout.capacity - l - d,
      length: layout.lengths[b] ?? 0,
    };
  });
}

function weakestOf(blocks: readonly BlockBudget[]): number {
  let weakest = 0;
  blocks.forEach((block, b) => {
    if (block.spare < (blocks[weakest]?.spare ?? Infinity)) weakest = b;
  });
  return weakest;
}

/**
 * What every block can still lose with the logo in place. `plate` is in scene modules, as the
 * placement engine returns it (`plateOf(box, padding)`), or null for a code without a logo.
 */
export function blockBudgets(
  matrix: Matrix,
  plate: LogoBox | null,
  quietZone: number,
): BlockBudget[] {
  const layout = layoutOf(matrix.version, matrix.ecl);
  return budgets(layout, plateCodewords(layout, plate, quietZone), new Set());
}

/**
 * Whether the code is still guaranteed to read with `damage` applied to the modules as drawn.
 *
 * A codeword is lost when at least one of its eight modules changes — ink on a dark module, or
 * paper on a light one, changes nothing. Modules under the plate are already lost and are not
 * counted twice.
 */
export function predictDamage(
  matrix: Matrix,
  plate: LogoBox | null,
  quietZone: number,
  damage: readonly Damage[],
): Prediction {
  const layout = layoutOf(matrix.version, matrix.ecl);
  const logo = plateCodewords(layout, plate, quietZone);
  const damaged = new Set<number>();
  let structural = 0;
  let outside = 0;
  const seen = new Set<number>();
  for (const { x, y, dark } of damage) {
    if (x < 0 || y < 0 || x >= layout.n || y >= layout.n) {
      outside += 1;
      continue;
    }
    const key = y * layout.n + x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (underPlate(plate, quietZone, x, y)) continue;
    if (matrix.modules[y]?.[x] === dark) continue;
    if (layout.isFunction[y]?.[x] === true) {
      structural += 1;
      continue;
    }
    const c = layout.codewords[y]?.[x];
    if (c !== undefined && c >= 0) damaged.add(c);
  }
  const blocks = budgets(layout, logo, damaged);
  const weakest = weakestOf(blocks);
  const past = blocks.some((block) => block.spare < 0);
  const verdict = past
    ? 'past-guarantee'
    : structural > 0 || outside > 0
      ? 'decoder-decides'
      : 'guaranteed';
  return { blocks, weakest, structural, quietZone: outside, verdict };
}

/** Offsets within `maxRadius` of a module centre, nearest first. */
function offsetsByDistance(maxRadius: number): { dx: number; dy: number; d: number }[] {
  const out: { dx: number; dy: number; d: number }[] = [];
  const r = Math.ceil(maxRadius);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d <= maxRadius) out.push({ dx, dy, d });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx);
}

/**
 * The smallest round smudge that takes the code past its guarantee, wherever it falls on the
 * data. Every codeword it touches is assumed lost — a smudge may darken or lighten, and the worst
 * case is the one that matters. Function patterns it crosses are not counted: what they do to a
 * decoder is the decoder's business, and the spot is about the arithmetic.
 *
 * The search grows a disk around every module centre and stops at the first radius where some
 * block runs out; the smallest of those is the answer. Ties go to the spot nearest the top left,
 * so the answer is the same every time it is asked. Returns null when no disk within the symbol
 * can do it, which only an empty symbol would manage.
 */
export function weakestSpot(
  matrix: Matrix,
  plate: LogoBox | null,
  quietZone: number,
): WeakestSpot | null {
  const layout = layoutOf(matrix.version, matrix.ecl);
  const logo = plateCodewords(layout, plate, quietZone);
  const logoPerBlock = Array<number>(layout.numBlocks).fill(0);
  for (const c of logo) {
    const b = layout.blocks[c];
    if (b !== undefined) logoPerBlock[b] = (logoPerBlock[b] ?? 0) + 1;
  }
  const offsets = offsetsByDistance(layout.n);
  let best: { x: number; y: number; radius: number; block: number } | null = null;

  for (let cy = 0; cy < layout.n; cy += 1) {
    for (let cx = 0; cx < layout.n; cx += 1) {
      if (layout.isFunction[cy]?.[cx] === true || underPlate(plate, quietZone, cx, cy)) continue;
      const lost = Array<number>(layout.numBlocks).fill(0);
      const taken = new Set<number>();
      for (let i = 0; i < offsets.length; i += 1) {
        const o = offsets[i];
        if (o === undefined) break;
        if (best !== null && o.d > best.radius) break;
        const x = cx + o.dx;
        const y = cy + o.dy;
        const c = layout.codewords[y]?.[x];
        if (c === undefined || c < 0 || logo.has(c) || taken.has(c)) continue;
        taken.add(c);
        const b = layout.blocks[c];
        if (b === undefined) continue;
        lost[b] = (lost[b] ?? 0) + 1;
        if ((logoPerBlock[b] ?? 0) + (lost[b] ?? 0) > layout.capacity) {
          // Every offset at this same distance belongs to the same disk.
          if (best === null || o.d < best.radius) {
            best = { x: cx, y: cy, radius: o.d, block: b };
          }
          break;
        }
      }
    }
  }
  if (best === null) return null;
  const { x, y, radius, block } = best;
  const cells: { x: number; y: number }[] = [];
  for (const o of offsets) {
    if (o.d > radius) break;
    const cx = x + o.dx;
    const cy = y + o.dy;
    if (cx >= 0 && cy >= 0 && cx < layout.n && cy < layout.n) cells.push({ x: cx, y: cy });
  }
  return { x, y, radius, block, cells };
}

/**
 * The figures to set beside "30 %": what the code could lose spread evenly, before and after the
 * logo, and how small a share of the symbol its weakest spot is.
 */
export function headroom(matrix: Matrix, plate: LogoBox | null, quietZone: number): Headroom {
  const layout = layoutOf(matrix.version, matrix.ecl);
  const blocks = budgets(layout, plateCodewords(layout, plate, quietZone), new Set());
  const total = Math.floor(rawDataModules(matrix.version) / 8);
  const textbook = (layout.capacity * layout.numBlocks) / total;
  const afterLogo = blocks.reduce((sum, b) => sum + Math.max(0, b.capacity - b.logo), 0) / total;
  const spot = weakestSpot(matrix, plate, quietZone);
  const weakestShare = spot === null ? 1 : spot.cells.length / (layout.n * layout.n);
  return { textbook, afterLogo, weakestShare };
}

/** Error-correction codewords per block, re-exported for the screen's sentence. */
export function ecCodewords(version: number, ecl: Ecl): number {
  return EC_CODEWORDS_PER_BLOCK[ecl][version] ?? 0;
}
