/**
 * The proof sheet (SPEC §10, P1): one page that carries the same code at the sizes people actually
 * print, so a person can print one sheet on their own printer, hold a phone over it, and find the
 * smallest size that reads **before** a thousand copies are made.
 *
 * The domain decides which sizes go on the sheet and how many pixels each is rendered at — with
 * the same rounding the export uses, so a 25 mm code on the sheet is the 295 px raster a 25 mm
 * export would be. The host verifies each size on its own and draws only the ones that read.
 */

import {
  MAX_PIXELS,
  MIN_PIXELS,
  formatMillimetres,
  pixelsFor,
  toMillimetres,
  type PrintSize,
} from './size';

/** The sizes every sheet carries: a lapel badge, a label, a business card, a table tent. */
export const PROOF_SIZES_MM: readonly number[] = [15, 20, 25, 30];

/**
 * The widest code an A4 page can hold with its margins: 210 mm less 10 mm on each side. A chosen
 * size past this is left off the sheet, and the sheet says so.
 */
export const MAX_PROOF_MM = 190;

/** One size on the sheet. */
export interface ProofSize {
  /** The printed width of the whole code, quiet zone included. */
  mm: number;
  /** The raster's side at the sheet's resolution — what the host renders and verifies. */
  pixelSize: number;
  /** True for the size chosen on the Create screen. */
  chosen: boolean;
  /**
   * Null when the size can be rendered at this resolution; otherwise the sentence that goes in
   * its box instead of a picture. The host never renders a size the domain has already refused.
   */
  refused: string | null;
}

export interface ProofPlan {
  sizes: ProofSize[];
  /** A sentence for the sheet when the chosen size could not be put on it, or null. */
  note: string | null;
}

/**
 * The sizes on the sheet, smallest first: the four standard ones and the chosen size when it is
 * none of them. A size whose raster would fall outside what the host renders is still listed,
 * as a box with the reason, rather than dropped without a word. With the resolutions the Create
 * screen offers that never happens — 15 mm at 150 dpi is 89 pixels, inside the range — so this is
 * a guard for a resolution typed elsewhere; the box a sheet shows in practice is the decoder's
 * refusal of a size too small for the code's density, which the host decides.
 */
export function proofSizes(size: PrintSize): ProofPlan {
  const chosenMm = Number(formatMillimetres(toMillimetres(size)));
  const wanted = new Set<number>(PROOF_SIZES_MM);
  let note: string | null = null;
  if (chosenMm > MAX_PROOF_MM) {
    note =
      `The chosen ${formatMillimetres(chosenMm)} mm is wider than an A4 page can hold, so it is ` +
      'not on this sheet; the four smaller sizes are.';
  } else {
    wanted.add(chosenMm);
  }

  const sizes = [...wanted]
    .sort((a, b) => a - b)
    .map((mm): ProofSize => {
      const pixelSize = pixelsFor({ value: mm, unit: 'mm', dpi: size.dpi });
      let refused: string | null = null;
      if (pixelSize < MIN_PIXELS) {
        refused = `At ${size.dpi} dpi, ${formatMillimetres(mm)} mm is ${pixelSize} pixels — too few to render. Choose a finer resolution.`;
      } else if (pixelSize > MAX_PIXELS) {
        refused = `At ${size.dpi} dpi, ${formatMillimetres(mm)} mm is ${pixelSize} pixels — more than a code is rendered at. Choose a coarser resolution.`;
      }
      return { mm, pixelSize, chosen: mm === chosenMm, refused };
    });

  return { sizes, note };
}

/**
 * Roughly how far away a phone reads a code of this width: ten times the width is the rule of
 * thumb printers use. A rule of thumb, said as one — the sheet is how the person finds out.
 */
export function readingDistanceCm(mm: number): number {
  return Math.round(mm);
}

/** The name the save dialog offers: `menu-proof.pdf`, or `signatum-proof.pdf` without a name. */
export function proofFileName(name: string | null): string {
  const stem = (name ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '');
  return `${stem.length > 0 ? stem : 'signatum'}-proof.pdf`;
}
