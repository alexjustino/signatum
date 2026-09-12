/**
 * Where the logo goes. In F4 the answer is simple and conservative — a small square in the
 * middle — and the scan gate says whether the code still reads with it there. F5 replaces this
 * with the placement engine that knows the error-correction budget and every function pattern.
 */

import type { Matrix } from './qr/encode';

/** A rectangle in scene modules: the quiet zone is inside the coordinate system. */
export interface LogoBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Plate = 'none' | 'square' | 'rounded' | 'circle';

export const PLATES: readonly Plate[] = ['none', 'square', 'rounded', 'circle'];

export const PLATE_LABELS: Record<Plate, string> = {
  none: 'None',
  square: 'Square',
  rounded: 'Rounded',
  circle: 'Circle',
};

/** The share of the symbol's side a F4 logo takes: small enough to leave level H its margin. */
export const DEFAULT_LOGO_FRACTION = 0.2;

/** The smallest logo worth drawing, in modules. */
export const MIN_LOGO_MODULES = 5;

/**
 * A square box centred on the symbol. Its side is an odd number of modules, so that on a
 * symbol — whose side is always odd — the box sits exactly in the middle rather than half a
 * module to one side.
 */
export function centredLogoBox(
  matrix: Pick<Matrix, 'size'>,
  quietZone: number,
  fraction = DEFAULT_LOGO_FRACTION,
): LogoBox {
  if (!(fraction > 0 && fraction < 1)) {
    throw new Error('the logo fraction has to lie between 0 and 1');
  }
  let side = Math.max(MIN_LOGO_MODULES, Math.round(matrix.size * fraction));
  if (side % 2 === 0) side += 1;
  // A finder and its separator take eight modules from each edge; a version-1 symbol leaves a
  // five-module square between them, which is exactly the smallest logo.
  if (side > matrix.size - 2 * 8) {
    side = matrix.size - 2 * 8;
    if (side % 2 === 0) side -= 1;
  }
  const offset = quietZone + (matrix.size - side) / 2;
  return { x: offset, y: offset, width: side, height: side };
}
