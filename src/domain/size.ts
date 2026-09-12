/**
 * Size is an input (SPEC §2.5): a code is designed for the physical size it will be printed at
 * and the resolution it will be rendered at, and every number the export writes — the PNG's
 * pixels and its pixels-per-metre, the SVG's width, the PDF's page — comes from here.
 */

import { moduleSizeMm } from './density';

export type LengthUnit = 'mm' | 'in';

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'in'];

export const LENGTH_UNIT_LABELS: Record<LengthUnit, string> = { mm: 'mm', in: 'in' };

export interface PrintSize {
  /** The printed width of the whole code, quiet zone included, in `unit`. */
  value: number;
  unit: LengthUnit;
  /** Dots per inch of the raster the code is rendered at. */
  dpi: number;
}

export const DEFAULT_PRINT_SIZE: PrintSize = { value: 25, unit: 'mm', dpi: 300 };

/** The resolutions offered: screen, print, fine print, imagesetter. */
export const DPI_CHOICES: readonly number[] = [150, 300, 600, 1200];

export const MM_PER_INCH = 25.4;

/** The printed widths accepted, in millimetres: a lapel pin to a poster. */
export const MIN_PRINT_MM = 5;
export const MAX_PRINT_MM = 1000;

/**
 * The raster the host renders and verifies is between these sides, in pixels; the export is
 * that same raster, so a size and resolution that fall outside are refused here rather than
 * rendered at some other size the decoder never saw.
 */
export const MIN_PIXELS = 64;
export const MAX_PIXELS = 4096;

export function toMillimetres(size: Pick<PrintSize, 'value' | 'unit'>): number {
  return size.unit === 'in' ? size.value * MM_PER_INCH : size.value;
}

/** The raster's side in pixels: 25 mm at 300 dpi is 295. */
export function pixelsFor(size: PrintSize): number {
  return Math.round((toMillimetres(size) / MM_PER_INCH) * size.dpi);
}

/** Pixels per metre, as the PNG `pHYs` chunk records them: 300 dpi is 11 811. */
export function pixelsPerMetre(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

/** The width of one module on paper. */
export function moduleMillimetres(side: number, size: PrintSize): number {
  return moduleSizeMm(side, toMillimetres(size));
}

export type PrintSizeVerdict = { ok: true } | { ok: false; reason: string; field: 'value' | 'dpi' };

export function checkPrintSize(size: PrintSize): PrintSizeVerdict {
  if (!Number.isFinite(size.value) || size.value <= 0) {
    return { ok: false, reason: 'Type the width the code will be printed at.', field: 'value' };
  }
  const mm = toMillimetres(size);
  if (mm < MIN_PRINT_MM || mm > MAX_PRINT_MM) {
    const low = size.unit === 'in' ? (MIN_PRINT_MM / MM_PER_INCH).toFixed(1) : `${MIN_PRINT_MM}`;
    const high = size.unit === 'in' ? (MAX_PRINT_MM / MM_PER_INCH).toFixed(1) : `${MAX_PRINT_MM}`;
    return {
      ok: false,
      reason: `A code is printed between ${low} and ${high} ${size.unit} wide.`,
      field: 'value',
    };
  }
  if (!DPI_CHOICES.includes(size.dpi)) {
    return { ok: false, reason: 'Choose one of the resolutions offered.', field: 'dpi' };
  }
  const pixels = pixelsFor(size);
  if (pixels > MAX_PIXELS) {
    return {
      ok: false,
      reason:
        `At this size and resolution the image would be ${pixels} pixels wide; the most ` +
        `that is rendered is ${MAX_PIXELS}. Lower the resolution.`,
      field: 'dpi',
    };
  }
  if (pixels < MIN_PIXELS) {
    return {
      ok: false,
      reason:
        `At this size and resolution the image would be ${pixels} pixels wide, too few to ` +
        `verify; the least that is rendered is ${MIN_PIXELS}. Raise the resolution.`,
      field: 'dpi',
    };
  }
  return { ok: true };
}

/** A number of millimetres the way a person writes it: 25, 12.5, 0.75. */
export function formatMillimetres(mm: number): string {
  return String(Number(mm.toFixed(2)));
}

/**
 * The scene's SVG with its printed size written in: the viewBox and everything inside it are
 * byte-identical to what was verified; only `width` and `height` are inserted after the viewBox.
 */
export function sizedSvg(svg: string, size: PrintSize): string {
  const mm = formatMillimetres(toMillimetres(size));
  const marker = /(<svg\b[^>]*?viewBox="[^"]*")/;
  if (!marker.test(svg)) throw new Error('the scene has no viewBox to size');
  return svg.replace(marker, `$1 width="${mm}mm" height="${mm}mm"`);
}
