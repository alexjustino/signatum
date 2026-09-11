/**
 * The QR matrix, from the vendored encoder (ADR-011: the encoder's lineage is Project Nayuki's;
 * the decoder that checks its output must not share it).
 *
 * This is the only file that touches the vendored namespace. Everything above it sees a plain
 * `Matrix`: a square of booleans, `true` for a dark module.
 */

import { qrcodegen } from './vendor/qrcodegen';

/** Error-correction level, in the standard's own letters. */
export type Ecl = 'L' | 'M' | 'Q' | 'H';

export const ECLS: readonly Ecl[] = ['L', 'M', 'Q', 'H'];

/** A mask pattern, 0–7, or `'auto'` to let the encoder pick the one with the lowest penalty. */
export type Mask = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'auto';

export const MASKS: readonly (0 | 1 | 2 | 3 | 4 | 5 | 6 | 7)[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** The symbol as modules. `modules[y][x]` is `true` when the module at column x, row y is dark. */
export interface Matrix {
  /** Modules per side, 21 for version 1 up to 177 for version 40. */
  size: number;
  /** 1–40. */
  version: number;
  ecl: Ecl;
  /** 0–7, the mask pattern the encoder chose or was told to use. */
  mask: number;
  modules: boolean[][];
}

export interface EncodeOptions {
  ecl: Ecl;
  /** Smallest version to consider (1–40). Default 1. */
  minVersion?: number;
  /** Largest version to consider (1–40). Default 40. */
  maxVersion?: number;
  /** Default `'auto'`. */
  mask?: Mask;
  /**
   * Whether the encoder may raise the level when doing so costs no extra version — the
   * standard's own advice, and the default. Turn it off to get exactly the level asked for.
   */
  boostEcl?: boolean;
}

const ECC: Record<Ecl, qrcodegen.QrCode.Ecc> = {
  L: qrcodegen.QrCode.Ecc.LOW,
  M: qrcodegen.QrCode.Ecc.MEDIUM,
  Q: qrcodegen.QrCode.Ecc.QUARTILE,
  H: qrcodegen.QrCode.Ecc.HIGH,
};

const ECL_BY_ORDINAL: readonly Ecl[] = ['L', 'M', 'Q', 'H'];

/** The most bytes a QR code can carry at all: version 40, level L, byte mode. */
export const MAX_PAYLOAD_BYTES = 2953;

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/**
 * Encode text at the given level, in the smallest version that fits. The encoder picks numeric,
 * alphanumeric or byte segments by itself; the level is never lowered (a higher one may be chosen
 * by the encoder when it costs no extra version, which is the standard's own advice).
 *
 * Throws when the text does not fit in version 40 at that level.
 */
export function encodeText(text: string, ecl: Ecl): Matrix {
  return encode(text, { ecl });
}

/**
 * Encode text with every knob the standard offers: the version range, the mask, and whether the
 * level may be raised. Segments are still chosen by content — digits become a numeric segment,
 * the alphanumeric alphabet an alphanumeric one, anything else bytes of UTF-8.
 */
export function encode(text: string, options: EncodeOptions): Matrix {
  return encodeSegments(qrcodegen.QrSegment.makeSegments(text), options);
}

/**
 * Encode arbitrary bytes in byte mode. What comes out is what went in, byte for byte — the
 * standard does not say what the bytes mean, and neither does this.
 */
export function encodeBytes(bytes: Uint8Array, options: EncodeOptions): Matrix {
  return encodeSegments([qrcodegen.QrSegment.makeBytes(Array.from(bytes))], options);
}

function encodeSegments(segments: readonly qrcodegen.QrSegment[], options: EncodeOptions): Matrix {
  const minVersion = options.minVersion ?? MIN_VERSION;
  const maxVersion = options.maxVersion ?? MAX_VERSION;
  const mask = options.mask ?? 'auto';
  if (
    !Number.isInteger(minVersion) ||
    !Number.isInteger(maxVersion) ||
    minVersion < MIN_VERSION ||
    maxVersion > MAX_VERSION ||
    minVersion > maxVersion
  ) {
    throw new Error('the version range has to lie within 1 to 40');
  }
  const code = qrcodegen.QrCode.encodeSegments(
    segments,
    ECC[options.ecl],
    minVersion,
    maxVersion,
    mask === 'auto' ? -1 : mask,
    options.boostEcl ?? true,
  );
  return toMatrix(code);
}

function toMatrix(code: qrcodegen.QrCode): Matrix {
  const size = code.size;
  const modules: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) {
      row.push(code.getModule(x, y));
    }
    modules.push(row);
  }
  const ecl = ECL_BY_ORDINAL[code.errorCorrectionLevel.ordinal];
  if (ecl === undefined) {
    throw new Error('the encoder reported an error-correction level that does not exist');
  }
  return { size, version: code.version, ecl, mask: code.mask, modules };
}
