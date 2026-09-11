/**
 * What the standard fixes about a symbol, read back from a matrix: its size, where the function
 * patterns are, and the format and version information it carries.
 *
 * This file writes nothing. It is the other half of the encoder — the reading — and it follows
 * ISO/IEC 18004 directly, so that a matrix the encoder produced can be checked against the
 * standard rather than against the encoder's own idea of itself. The Read screen (F10) will
 * grow from here.
 */

import type { Ecl, Matrix } from './encode';

/** Modules per side of a version: 17 + 4·version. */
export function sizeOfVersion(version: number): number {
  return 17 + 4 * version;
}

/**
 * The two bits that name a level in format information (ISO/IEC 18004, Table 12): L = 01,
 * M = 00, Q = 11, H = 10 — not the order the letters suggest.
 */
export const ECL_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

const ECL_OF_BITS: readonly Ecl[] = ['M', 'L', 'H', 'Q'];

/** The mask XORed into every format string (ISO/IEC 18004, 7.9): 101010000010010. */
export const FORMAT_MASK = 0x5412;

/**
 * The 15-bit format string for a level and a mask: 5 data bits, 10 BCH(15, 5) remainder bits
 * over the generator 10100110111, XORed with `FORMAT_MASK`. ISO/IEC 18004, Annex C.
 */
export function formatBits(ecl: Ecl, mask: number): number {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ FORMAT_MASK;
}

/**
 * The 18-bit version string for versions 7 to 40: 6 data bits, 12 BCH(18, 6) remainder bits over
 * the generator 1111100100101. ISO/IEC 18004, Annex D.
 */
export function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

/**
 * The row and column centres of the alignment patterns of a version (ISO/IEC 18004, Annex E):
 * none for version 1, and for the rest an evenly spaced set that starts at 6 and ends at
 * size − 7, the step rounded up to an even number.
 */
export function alignmentCentres(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = sizeOfVersion(version);
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const centres = [6];
  for (let position = size - 7; centres.length < count; position -= step) {
    centres.splice(1, 0, position);
  }
  return centres;
}

function bit(m: Matrix, x: number, y: number): number {
  return m.modules[y]?.[x] === true ? 1 : 0;
}

/**
 * Read the two copies of the format information a matrix carries. The first copy sits beside
 * the top-left finder, the second is split between the other two finders (ISO/IEC 18004, 7.9,
 * Figure 25). Both are returned so that a caller can insist they agree.
 */
export function readFormatBits(m: Matrix): { first: number; second: number } {
  const n = m.size;
  let first = 0;
  // Bits 0–5 run down column 8, rows 0–5; bit 6 at (8, 7); bit 7 at (8, 8); bit 8 at (7, 8);
  // bits 9–14 run along row 8 from column 5 to column 0.
  for (let i = 0; i <= 5; i += 1) first |= bit(m, 8, i) << i;
  first |= bit(m, 8, 7) << 6;
  first |= bit(m, 8, 8) << 7;
  first |= bit(m, 7, 8) << 8;
  for (let i = 9; i <= 14; i += 1) first |= bit(m, 14 - i, 8) << i;

  let second = 0;
  // Bits 0–7 run along row 8 from the right edge inwards; bits 8–14 run down column 8 from
  // row size − 7 to the bottom edge.
  for (let i = 0; i <= 7; i += 1) second |= bit(m, n - 1 - i, 8) << i;
  for (let i = 8; i <= 14; i += 1) second |= bit(m, 8, n - 15 + i) << i;
  return { first, second };
}

/** Decode a format string: undo the mask, check the BCH code, and name the level and the mask. */
export function decodeFormat(bits: number): { ecl: Ecl; mask: number } | null {
  const data = (bits ^ FORMAT_MASK) >>> 10;
  const eclBits = data >>> 3;
  const mask = data & 7;
  const ecl = ECL_OF_BITS[eclBits];
  if (ecl === undefined || formatBits(ecl, mask) !== bits) return null;
  return { ecl, mask };
}

/**
 * Read the two copies of the version information of a version-7-or-larger symbol: a 6×3 block
 * above the bottom-left finder and its transpose left of the top-right finder (ISO/IEC 18004,
 * 7.10, Figure 26). Returns null for versions below 7, which carry none.
 */
export function readVersionBits(m: Matrix): { first: number; second: number } | null {
  if (m.size < sizeOfVersion(7)) return null;
  const n = m.size;
  let first = 0;
  let second = 0;
  for (let i = 0; i < 18; i += 1) {
    const a = n - 11 + (i % 3);
    const b = Math.floor(i / 3);
    first |= bit(m, a, b) << i;
    second |= bit(m, b, a) << i;
  }
  return { first, second };
}

/** Decode a version string: check the BCH code and return the version, or null. */
export function decodeVersion(bits: number): number | null {
  const version = bits >>> 12;
  if (version < 7 || version > 40 || versionBits(version) !== bits) return null;
  return version;
}

/** The 7×7 finder pattern, read row by row. */
const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];

/** The 5×5 alignment pattern. */
const ALIGNMENT = ['#####', '#...#', '#.#.#', '#...#', '#####'];

function patternAt(m: Matrix, rows: readonly string[], left: number, top: number): boolean {
  return rows.every((row, dy) =>
    [...row].every((cell, dx) => m.modules[top + dy]?.[left + dx] === (cell === '#')),
  );
}

/**
 * Every function pattern the standard fixes, checked against the matrix: the three finders
 * with their light separators, the two timing patterns, the dark module, and every alignment
 * pattern of the version. Returns the first thing that is wrong, or null when all is in place.
 */
export function checkFunctionPatterns(m: Matrix): string | null {
  const n = m.size;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    return `a side of ${n} modules is not a version`;
  }
  for (const [left, top, name] of [
    [0, 0, 'top-left'],
    [n - 7, 0, 'top-right'],
    [0, n - 7, 'bottom-left'],
  ] as const) {
    if (!patternAt(m, FINDER, left, top)) return `the ${name} finder is not drawn`;
  }
  // Separators: the light line around each finder, inside the symbol.
  for (let i = 0; i < 8; i += 1) {
    const light = [
      [7, i],
      [i, 7],
      [n - 8, i],
      [n - 8 + i, 7],
      [7, n - 8 + i],
      [i, n - 8],
    ] as const;
    for (const [x, y] of light) {
      if (bit(m, x, y) === 1) return `the separator at (${x}, ${y}) is dark`;
    }
  }
  for (let i = 8; i < n - 8; i += 1) {
    const expected = i % 2 === 0 ? 1 : 0;
    if (bit(m, i, 6) !== expected) return `the horizontal timing pattern breaks at column ${i}`;
    if (bit(m, 6, i) !== expected) return `the vertical timing pattern breaks at row ${i}`;
  }
  if (bit(m, 8, 4 * version + 9) !== 1) return 'the dark module is light';
  const centres = alignmentCentres(version);
  for (const cy of centres) {
    for (const cx of centres) {
      // Alignment patterns that would overlap a finder are omitted (ISO/IEC 18004, 7.3.5).
      const overlapsFinder =
        (cx <= 8 && cy <= 8) || (cx >= n - 9 && cy <= 8) || (cx <= 8 && cy >= n - 9);
      if (overlapsFinder) continue;
      if (!patternAt(m, ALIGNMENT, cx - 2, cy - 2)) {
        return `the alignment pattern centred at (${cx}, ${cy}) is not drawn`;
      }
    }
  }
  return null;
}
