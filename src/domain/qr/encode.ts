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

/** The symbol as modules. `modules[y][x]` is `true` when the module at column x, row y is dark. */
export interface Matrix {
  /** Modules per side, 21 for version 1 up to 177 for version 40. */
  size: number;
  /** 1–40. */
  version: number;
  ecl: Ecl;
  /** 0–7, the mask pattern the encoder chose. */
  mask: number;
  modules: boolean[][];
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

/**
 * Encode text at the given level, in the smallest version that fits. The encoder picks numeric,
 * alphanumeric or byte segments by itself; the level is never lowered (a higher one may be chosen
 * by the encoder when it costs no extra version, which is the standard's own advice).
 *
 * Throws when the text does not fit in version 40 at that level.
 */
export function encodeText(text: string, ecl: Ecl): Matrix {
  const code = qrcodegen.QrCode.encodeText(text, ECC[ecl]);
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
