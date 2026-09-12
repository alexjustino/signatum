/**
 * The look of a code, and the two rules that keep a look scannable: the colours must contrast,
 * and the code should be darker than its plate. Neither is the scan gate — the gate decides on
 * the bytes — but a look that fails here is refused before the gate is asked, with the reason,
 * because a camera in a dim room is less forgiving than a clean raster.
 */

export type ModuleShape = 'square' | 'rounded' | 'dot';
export type FinderShape = 'square' | 'rounded';

export const MODULE_SHAPES: readonly ModuleShape[] = ['square', 'rounded', 'dot'];
export const FINDER_SHAPES: readonly FinderShape[] = ['square', 'rounded'];

export const MODULE_SHAPE_LABELS: Record<ModuleShape, string> = {
  square: 'Square',
  rounded: 'Rounded',
  dot: 'Dots',
};

export const FINDER_SHAPE_LABELS: Record<FinderShape, string> = {
  square: 'Square',
  rounded: 'Rounded',
};

/**
 * The least contrast a code may have, as the WCAG ratio between its two colours. Text needs 4.5
 * to be read by a person; a code needs at least that to be read by a camera that also has to
 * find the grid.
 */
export const MIN_CONTRAST = 4.5;

/** The quiet zone the standard asks for; under it, most scans fail. */
export const MIN_QUIET_ZONE = 4;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a six-digit hex colour, per WCAG 2 (sRGB). */
export function luminance(colour: string): number {
  const m = HEX.exec(colour);
  if (m === null) throw new Error('a colour has to be a six-digit hex value like #1a2b3c');
  const [, r, g, b] = m;
  return 0.2126 * channel(r ?? '00') + 0.7152 * channel(g ?? '00') + 0.0722 * channel(b ?? '00');
}

/** The WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export interface Colours {
  foreground: string;
  background: string;
}

/** True when the code would be lighter than its plate — which most cameras will not read. */
export function isInverted(colours: Colours): boolean {
  return luminance(colours.foreground) > luminance(colours.background);
}

export type ContrastVerdict =
  { ok: true; ratio: number } | { ok: false; ratio: number; reason: string };

/** Whether the two colours are far enough apart, and the right way round, for a camera. */
export function checkContrast(colours: Colours): ContrastVerdict {
  const ratio = contrastRatio(colours.foreground, colours.background);
  if (ratio < MIN_CONTRAST) {
    return {
      ok: false,
      ratio,
      reason:
        `These colours are too close: contrast ${ratio.toFixed(1)}, ` +
        `and a camera needs at least ${MIN_CONTRAST}.`,
    };
  }
  if (isInverted(colours)) {
    return {
      ok: false,
      ratio,
      reason:
        'The code is lighter than its background; most cameras read only a dark code on a ' +
        'light plate.',
    };
  }
  return { ok: true, ratio };
}

/** The sentence for a quiet zone under the standard's, or `null` when it is enough. */
export function quietZoneWarning(quietZone: number): string | null {
  if (quietZone >= MIN_QUIET_ZONE) return null;
  if (quietZone <= 0) {
    return 'There is no quiet zone; a camera needs a blank margin to find the code at all.';
  }
  return `A quiet zone under ${MIN_QUIET_ZONE} modules is where most scans fail.`;
}
