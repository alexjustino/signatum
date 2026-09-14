/**
 * The logo's vocabulary: the box it fills, the plate it sits on, and the sizes a person may
 * ask for.
 *
 * Where the box goes is not decided here. The placement engine (`placement.ts`) knows the
 * error-correction budget and every function pattern, and it is the one that answers — this
 * file only names the things a person chooses between, so the screen, the scene and the
 * engine say them the same way.
 */

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

/** How big a logo is asked to be — never how big it will be; the budget decides that. */
export type LogoSize = 'largest' | 'medium' | 'small';

export const LOGO_SIZES: readonly LogoSize[] = ['largest', 'medium', 'small'];

export const LOGO_SIZE_LABELS: Record<LogoSize, string> = {
  largest: 'Largest',
  medium: 'Medium',
  small: 'Small',
};

/**
 * The share of the symbol's side a size asks for, or nothing at all.
 *
 * "Largest" asks for no share: the engine gives whatever the error-correction budget allows,
 * which is the most a logo is ever allowed to take. The other two ask for less than that —
 * "or smaller by choice, never larger" (SPEC §2.2) — and a share larger than the budget's
 * answer is ignored by the engine rather than honoured.
 */
export function logoFraction(size: LogoSize): number | undefined {
  switch (size) {
    case 'largest':
      return undefined;
    case 'medium':
      return 0.2;
    case 'small':
      return 0.12;
  }
}
