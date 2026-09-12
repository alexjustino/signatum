/**
 * The placement engine (ADR-013): the logo is a region of the matrix, not an image on top.
 *
 * The engine knows every function pattern and never covers one; it sizes the plate from the
 * error-correction budget with a safety factor, knocks out the modules under the plate so no
 * half-module shows at its edge, chooses the mask again with the knock-out in place, and picks
 * the level and version a logo needs. A logo that cannot fit is refused with the reason.
 *
 * The tables are the standard's (ISO/IEC 18004, Table 9): error-correction codewords per block
 * and blocks per version, for each level. They are copied here rather than read from the
 * vendored encoder, whose copy is private — the values are the standard's, not the encoder's.
 */

import type { LogoBox } from './logo';
import { ECLS, MASKS, encode, type Ecl, type Matrix } from './qr/encode';
import { alignmentCentres, sizeOfVersion } from './qr/structure';

/** Error-correction codewords per block, by level then version (index 0 unused). */
export const EC_CODEWORDS_PER_BLOCK: Record<Ecl, readonly number[]> = {
  L: [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

/** Error-correction blocks, by level then version (index 0 unused). */
export const EC_BLOCKS: Record<Ecl, readonly number[]> = {
  L: [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
    40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/** Modules available to data and error correction after every function pattern is excluded. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/**
 * The function-pattern map: `true` where a module belongs to a finder, a separator, the format
 * or version information, a timing pattern, an alignment pattern or the dark module — every
 * module the placement engine must never cover.
 */
export interface FunctionMapOptions {
  /**
   * Leave the middle alignment pattern out of the map — the one a centred logo cannot avoid on
   * versions 7–13, 21–27 and 35–40, where an odd number of alignment centres puts one at, or
   * two modules beside, the exact centre (ADR-024, proposed): decoders locate the grid from the
   * finders and the outer alignment patterns, and the scan gate is the judge of whether a code
   * still reads without it.
   */
  exceptCentreAlignment?: boolean;
}

export function functionModules(version: number, options: FunctionMapOptions = {}): boolean[][] {
  const n = sizeOfVersion(version);
  const map: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const mark = (x: number, y: number) => {
    const row = map[y];
    if (row !== undefined && x >= 0 && x < n) row[x] = true;
  };
  // Finders with separators and the format information beside them: 9×9 at the top left,
  // 8 wide by 9 tall at the top right, 9 wide by 8 tall at the bottom left (the dark module
  // sits inside that last one).
  for (let i = 0; i < 9; i += 1) {
    for (let j = 0; j < 9; j += 1) {
      mark(i, j);
      if (i < 8) mark(n - 1 - i, j);
      if (j < 8) mark(i, n - 1 - j);
    }
  }
  for (let i = 0; i < n; i += 1) {
    mark(i, 6);
    mark(6, i);
  }
  const centres = alignmentCentres(version);
  const middle = middleAlignmentCentre(version);
  for (const cy of centres) {
    for (const cx of centres) {
      const overlapsFinder =
        (cx <= 8 && cy <= 8) || (cx >= n - 9 && cy <= 8) || (cx <= 8 && cy >= n - 9);
      if (overlapsFinder) continue;
      if (options.exceptCentreAlignment === true && cx === middle && cy === middle) continue;
      for (let dy = -2; dy <= 2; dy += 1)
        for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return map;
}

/**
 * Which codeword of the final sequence each module carries: the standard's placement walks
 * two-module columns from the right edge, up then down, skipping the timing column and every
 * function module (ISO/IEC 18004, 7.7.3). Function modules are −1; remainder bits are −2.
 */
export function codewordMap(version: number): number[][] {
  const n = sizeOfVersion(version);
  const isFunction = functionModules(version);
  const map: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(-1));
  const dataBits = Math.floor(rawDataModules(version) / 8) * 8;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (isFunction[y]?.[x] === true) continue;
        const row = map[y];
        if (row === undefined) continue;
        row[x] = i < dataBits ? Math.floor(i / 8) : -2;
        i += 1;
      }
    }
  }
  return map;
}

/**
 * Which error-correction block each codeword of the final sequence belongs to. The blocks are
 * interleaved codeword by codeword, the short blocks skipping the position their long siblings
 * fill (ISO/IEC 18004, 7.6) — so a contiguous covered region spreads its damage across blocks.
 */
export function blockOfCodeword(version: number, ecl: Ecl): number[] {
  const numBlocks = EC_BLOCKS[ecl][version] ?? 0;
  const ecLen = EC_CODEWORDS_PER_BLOCK[ecl][version] ?? 0;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const result: number[] = [];
  // Every block is considered `shortLen + 1` long; a short block has no codeword at the position
  // `shortLen - ecLen`, which is where its long siblings carry one extra data codeword.
  for (let i = 0; i <= shortLen; i += 1) {
    for (let j = 0; j < numBlocks; j += 1) {
      if (i === shortLen - ecLen && j < numShort) continue;
      result.push(j);
    }
  }
  return result;
}

/** How many codeword errors one block can absorb: half its error-correction codewords. */
export function correctablePerBlock(version: number, ecl: Ecl): number {
  return Math.floor((EC_CODEWORDS_PER_BLOCK[ecl][version] ?? 0) / 2);
}

/** The share of the correctable capacity a logo may use; the rest is for print and camera. */
export const SAFETY = 0.6;

/**
 * Whether a plate may sit on the alignment pattern at the exact centre of the symbol
 * (ADR-024, proposed). Off, a logo on versions 7–13 costs a jump to version 14.
 */
export const ALLOW_CENTRE_ALIGNMENT = true;

export interface Coverage {
  /** Codewords touched by the plate, per error-correction block. */
  perBlock: number[];
  /** The most any one block loses. */
  worst: number;
  /** What one block may lose, after the safety factor. */
  budget: number;
  /** Whether the plate touches a function module — which is never allowed. */
  touchesFunction: boolean;
}

/** The plate a box implies: the box grown by its padding on every side, in scene modules. */
export function plateOf(box: LogoBox, padding: number): LogoBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + 2 * padding,
    height: box.height + 2 * padding,
  };
}

/**
 * What a plate costs the code: the codewords it touches, block by block. `plate` is in scene
 * modules (quiet zone included); the symbol starts at `quietZone`.
 */
export function coverage(
  version: number,
  ecl: Ecl,
  plate: LogoBox,
  quietZone: number,
  safety = SAFETY,
  allowCentreAlignment = ALLOW_CENTRE_ALIGNMENT,
): Coverage {
  const n = sizeOfVersion(version);
  const isFunction = functionModules(version, { exceptCentreAlignment: allowCentreAlignment });
  const codewords = codewordMap(version);
  const blocks = blockOfCodeword(version, ecl);
  const touched = new Set<number>();
  let touchesFunction = false;
  for (let sy = plate.y; sy < plate.y + plate.height; sy += 1) {
    for (let sx = plate.x; sx < plate.x + plate.width; sx += 1) {
      const x = sx - quietZone;
      const y = sy - quietZone;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if (isFunction[y]?.[x] === true) {
        touchesFunction = true;
        continue;
      }
      const c = codewords[y]?.[x];
      if (c !== undefined && c >= 0) touched.add(c);
    }
  }
  const perBlock = Array<number>(EC_BLOCKS[ecl][version] ?? 0).fill(0);
  for (const c of touched) {
    const b = blocks[c];
    if (b !== undefined) perBlock[b] = (perBlock[b] ?? 0) + 1;
  }
  const worst = perBlock.reduce((m, v) => Math.max(m, v), 0);
  const budget = Math.floor(correctablePerBlock(version, ecl) * safety);
  return { perBlock, worst, budget, touchesFunction };
}

/** The smallest logo worth drawing, in modules. */
export const MIN_LOGO_MODULES = 5;

/** A square box of `side` modules centred on the symbol, in scene coordinates. */
export function centredBox(version: number, side: number, quietZone: number): LogoBox {
  const n = sizeOfVersion(version);
  const offset = quietZone + (n - side) / 2;
  return { x: offset, y: offset, width: side, height: side };
}

export type Verdict = { ok: true; coverage: Coverage } | { ok: false; reason: string };

/** Whether a box, with its plate, is allowed on this version at this level. */
export function checkBox(
  version: number,
  ecl: Ecl,
  box: LogoBox,
  padding: number,
  quietZone: number,
  safety = SAFETY,
  allowCentreAlignment = ALLOW_CENTRE_ALIGNMENT,
): Verdict {
  const cov = coverage(
    version,
    ecl,
    plateOf(box, padding),
    quietZone,
    safety,
    allowCentreAlignment,
  );
  if (cov.touchesFunction) {
    return {
      ok: false,
      reason:
        'The logo would cover a pattern the code cannot lose — a finder, the timing, an ' +
        'alignment pattern or the format information.',
    };
  }
  if (cov.worst > cov.budget) {
    return {
      ok: false,
      reason:
        `The logo is over the error-correction budget: it would cost one block ${cov.worst} ` +
        `codewords, and at level ${ecl} a block can spare ${cov.budget}.`,
    };
  }
  return { ok: true, coverage: cov };
}

/**
 * The largest centred square the budget allows on this version at this level, with its plate:
 * grown two modules at a time from the smallest logo until the budget or a function pattern
 * stops it. `null` when not even the smallest fits.
 */
export function largestBox(
  version: number,
  ecl: Ecl,
  padding: number,
  quietZone: number,
  safety = SAFETY,
  allowCentreAlignment = ALLOW_CENTRE_ALIGNMENT,
): { box: LogoBox; coverage: Coverage } | null {
  let best: { box: LogoBox; coverage: Coverage } | null = null;
  const n = sizeOfVersion(version);
  for (let side = MIN_LOGO_MODULES; side + 2 * padding <= n - 16; side += 2) {
    const box = centredBox(version, side, quietZone);
    const verdict = checkBox(version, ecl, box, padding, quietZone, safety, allowCentreAlignment);
    if (!verdict.ok) break;
    best = { box, coverage: verdict.coverage };
  }
  return best;
}

/** Light every module under the plate that is not a function module. */
export function knockOut(
  matrix: Matrix,
  plate: LogoBox,
  quietZone: number,
  allowCentreAlignment = ALLOW_CENTRE_ALIGNMENT,
): Matrix {
  const isFunction = functionModules(matrix.version, {
    exceptCentreAlignment: allowCentreAlignment,
  });
  const modules = matrix.modules.map((row) => row.slice());
  for (let sy = plate.y; sy < plate.y + plate.height; sy += 1) {
    for (let sx = plate.x; sx < plate.x + plate.width; sx += 1) {
      const x = sx - quietZone;
      const y = sy - quietZone;
      const row = modules[y];
      if (row === undefined || x < 0 || x >= matrix.size) continue;
      if (isFunction[y]?.[x] === true) continue;
      row[x] = false;
    }
  }
  return { ...matrix, modules };
}

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** The standard's mask penalty (ISO/IEC 18004, 7.8.3.1): the lower, the easier to read. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const n = modules.length;
  let result = 0;
  const line = (at: (i: number) => boolean) => {
    // Runs of one colour (N1) and finder-like 1:1:3:1:1 sequences with 4 light modules on a
    // side (N3), read along one row or column.
    const runs: number[] = [];
    const colours: boolean[] = [];
    let run = 0;
    let colour = at(0);
    for (let i = 0; i < n; i += 1) {
      const c = at(i);
      if (c === colour) {
        run += 1;
      } else {
        runs.push(run);
        colours.push(colour);
        colour = c;
        run = 1;
      }
    }
    runs.push(run);
    colours.push(colour);
    for (const r of runs) if (r >= 5) result += N1 + (r - 5);
    for (let k = 0; k + 4 < runs.length; k += 1) {
      if (colours[k] !== true) continue;
      const a = runs[k] ?? 0;
      if (runs[k + 1] === a && runs[k + 2] === 3 * a && runs[k + 3] === a && runs[k + 4] === a) {
        const before = k > 0 ? (runs[k - 1] ?? 0) : 4;
        const after = k + 5 < runs.length ? (runs[k + 5] ?? 0) : 4;
        if (before >= 4 || after >= 4) result += N3;
      }
    }
  };
  for (let y = 0; y < n; y += 1) line((x) => modules[y]?.[x] === true);
  for (let x = 0; x < n; x += 1) line((y) => modules[y]?.[x] === true);
  for (let y = 0; y + 1 < n; y += 1) {
    for (let x = 0; x + 1 < n; x += 1) {
      const c = modules[y]?.[x];
      if (c === modules[y]?.[x + 1] && c === modules[y + 1]?.[x] && c === modules[y + 1]?.[x + 1]) {
        result += N2;
      }
    }
  }
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark += 1;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += Math.max(0, k) * N4;
  return result;
}

/**
 * The alignment centre in the middle of the symbol, when the version has an odd number of
 * alignment centres (three, five or seven): at the exact centre on most of them, up to four
 * modules off on versions 22 to 27 and 36 to 40, where the standard's rounding shifts the row.
 * Null when the count is even and the middle of the symbol is free.
 */
export function middleAlignmentCentre(version: number): number | null {
  const centres = alignmentCentres(version);
  if (centres.length < 3 || centres.length % 2 === 0) return null;
  return centres[(centres.length - 1) / 2] ?? null;
}

/** Versions with an alignment pattern in the middle: 7 to 13, 21 to 27 and 35 to 40. */
export function hasCentreAlignment(version: number): boolean {
  return middleAlignmentCentre(version) !== null;
}

export interface PlanOptions {
  /** Whether a logo will sit on the code. */
  logo: boolean;
  /** The lowest level acceptable; with a logo the engine starts at H and never goes below Q. */
  ecl?: Ecl;
  padding?: number;
  quietZone: number;
  safety?: number;
  /** A smaller box than the largest allowed, as a share of the symbol's side; never larger. */
  fraction?: number;
  /** See `ALLOW_CENTRE_ALIGNMENT`. */
  allowCentreAlignment?: boolean;
}

export type Plan =
  | {
      ok: true;
      matrix: Matrix;
      ecl: Ecl;
      version: number;
      mask: number;
      /** The logo box in scene modules, or null when there is no logo. */
      box: LogoBox | null;
      coverage: Coverage | null;
    }
  | { ok: false; reason: string };

function tryEncode(text: string, ecl: Ecl, minVersion: number, boostEcl = false): Matrix | null {
  try {
    return encode(text, { ecl, minVersion, boostEcl });
  } catch {
    return null;
  }
}

/**
 * The whole decision for one code: the level, the version, the mask and — with a logo — the
 * box. With a logo the level starts at H and falls back to Q; the version skips the ones whose
 * centre is an alignment pattern and grows until the smallest logo fits; the mask is chosen
 * with the knock-out in place; the box is the largest the budget allows, or the smaller share
 * asked for.
 */
export function planCode(text: string, options: PlanOptions): Plan {
  const padding = options.padding ?? 1;
  const safety = options.safety ?? SAFETY;
  const quietZone = options.quietZone;
  const allowCentre = options.allowCentreAlignment ?? ALLOW_CENTRE_ALIGNMENT;
  if (!options.logo) {
    // Without a logo the encoder may raise the level when it costs no extra version — the
    // standard's own advice, and the behaviour the product has had since its first slice.
    const ecl = options.ecl ?? 'M';
    const matrix = tryEncode(text, ecl, 1, true);
    if (matrix === null) {
      return { ok: false, reason: `This content does not fit in a code at level ${ecl}.` };
    }
    return {
      ok: true,
      matrix,
      ecl: matrix.ecl,
      version: matrix.version,
      mask: matrix.mask,
      box: null,
      coverage: null,
    };
  }

  const floor = options.ecl ?? 'Q';
  const candidates: Ecl[] = ['H', 'Q'];
  const levels = candidates.filter((l) => ECLS.indexOf(l) >= ECLS.indexOf(floor));
  for (const ecl of levels) {
    let minVersion = 2;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const first = tryEncode(text, ecl, minVersion);
      if (first === null) break;
      let version = first.version;
      if (!allowCentre && hasCentreAlignment(version)) {
        // Walk to the next version whose centre is free; there may be none.
        let next = version + 1;
        while (next <= 40 && hasCentreAlignment(next)) next += 1;
        if (next > 40) break;
        minVersion = next;
        continue;
      }
      const largest = largestBox(version, ecl, padding, quietZone, safety, allowCentre);
      if (largest === null) {
        minVersion = version + 1;
        continue;
      }
      let box = largest.box;
      let cov = largest.coverage;
      if (options.fraction !== undefined) {
        const wanted = Math.round(sizeOfVersion(version) * options.fraction);
        const side = Math.max(MIN_LOGO_MODULES, wanted % 2 === 0 ? wanted + 1 : wanted);
        if (side < box.width) {
          const smaller = centredBox(version, side, quietZone);
          const verdict = checkBox(version, ecl, smaller, padding, quietZone, safety, allowCentre);
          if (verdict.ok) {
            box = smaller;
            cov = verdict.coverage;
          }
        }
      }
      const plate = plateOf(box, padding);
      let best: { matrix: Matrix; score: number } | null = null;
      for (const mask of MASKS) {
        const candidate = encode(text, {
          ecl,
          minVersion: version,
          maxVersion: version,
          mask,
          boostEcl: false,
        });
        const knocked = knockOut(candidate, plate, quietZone, allowCentre);
        const score = penalty(knocked.modules);
        if (best === null || score < best.score) best = { matrix: knocked, score };
      }
      if (best === null) break;
      version = best.matrix.version;
      return {
        ok: true,
        matrix: best.matrix,
        ecl,
        version,
        mask: best.matrix.mask,
        box,
        coverage: cov,
      };
    }
  }
  return {
    ok: false,
    reason:
      'A logo needs level Q or H, and this content does not fit in a code at those levels. ' +
      'Shorten the content, or make the code without a logo.',
  };
}
