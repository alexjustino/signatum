/**
 * How small a module gets at the size the code will be printed.
 *
 * A QR code does not fail gracefully when it is printed too small: it either reads or it does
 * not, and which one it is depends on a number nobody looks at — the size of a single module.
 * A phone camera at arm's length needs roughly half a millimetre of module to resolve one
 * reliably, and a card with a long note in it can easily be a version-20 symbol, whose 105
 * modules across a 25 mm sticker are 0.24 mm each. That code scans on the screen it was
 * designed on and fails on the wall it was printed on.
 *
 * So the number is computed and shown while there is still something to do about it. This is a
 * warning and never a refusal: the print size is the person's to choose, and the scan gate —
 * which reads the actual exported bytes — is what decides whether a code leaves. What this
 * module adds is the one fact the gate cannot know, because it is not in the file: how big the
 * thing will be on paper.
 */

/** The size a code is assumed to be printed at until the export screen makes it an input. */
import type { PayloadForm } from './payload';

export const NOMINAL_PRINT_MM = 25;

/** Below half a millimetre a module, most phone cameras fail at arm's length. */
export const MIN_MODULE_MM = 0.5;

/**
 * One module, in millimetres.
 *
 * @param side Modules per side, the quiet zone included — the scene's own `side`, because the
 *   quiet zone is printed too and takes its share of the space.
 * @param printedMm The width the code will be printed at, in millimetres.
 */
export function moduleSizeMm(side: number, printedMm: number): number {
  if (!Number.isFinite(side) || side <= 0) return 0;
  if (!Number.isFinite(printedMm) || printedMm <= 0) return 0;
  return printedMm / side;
}

/** Millimetres as a person writes them: two decimals at most, no trailing zeros. */
function formatMm(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * The sentence to show when the code would be printed too dense to scan, or `null` when it
 * would not.
 *
 * The decision is taken on the rounded number the sentence shows, not on the exact one, so that
 * the screen never claims that 0.50 mm is below half a millimetre. A person reading a warning
 * that contradicts itself stops believing the next one.
 */
export function densityWarning(
  scene: { side: number },
  printedMm = NOMINAL_PRINT_MM,
  advice = DEFAULT_DENSITY_ADVICE,
): string | null {
  const module = moduleSizeMm(scene.side, printedMm);
  if (module <= 0) return null;
  const shown = Number(module.toFixed(2));
  if (shown >= MIN_MODULE_MM) return null;
  return (
    `At ${formatMm(printedMm)} mm this code's modules are ${module.toFixed(2)} mm — ` +
    `too small for most cameras. ${advice}`
  );
}

/** What to do about a dense code when there is nothing more specific to say. */
export const DEFAULT_DENSITY_ADVICE = 'Print it larger, or shorten the content.';

/**
 * The advice that fits the kind of code on screen: a vCard can become a MECARD, a MECARD can
 * only lose fields, and anything else can only be printed larger or made shorter.
 */
export function densityAdvice(form: PayloadForm): string {
  if (form.kind !== 'contact') return DEFAULT_DENSITY_ADVICE;
  return form.format === 'mecard' ? 'Use fewer fields.' : 'Use MECARD, or fewer fields.';
}
