/**
 * The sentences the product says about a code, decided once and shared by the screen, the
 * accessible names and the end-to-end suite — so that two readings of one fact agree.
 */

import type { Plan } from './placement';

/**
 * The accessible name of the preview figure, from the payload's own summary:
 * "Opens example.com" becomes "QR code that opens example.com", "Joins
 * Office-5G" becomes "QR code that joins Office-5G".
 *
 * It takes the summary rather than the payload because only the builder of a
 * kind knows how to say what scanning does — a `WIFI:T:WPA;S:...` string read
 * out to somebody is not a name. One sentence, said once, worn by the figure,
 * the helper line and the end-to-end suite alike.
 */
export function describeCode(summary: string): string {
  return `QR code that ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
}

/** What the scan gate knows about the code on screen. */
export interface GateReport {
  verified: boolean;
  reason: string | null;
  decoder: string;
}

export type GateState = 'pending' | 'verified' | 'refused';

/** The state the gate is in, from the last report and whether a check is still running. */
export function gateState(report: GateReport | null, inFlight: boolean): GateState {
  if (inFlight || report === null) return 'pending';
  return report.verified ? 'verified' : 'refused';
}

/** The sentence under the preview. */
export function describeGate(report: GateReport | null, inFlight: boolean): string {
  switch (gateState(report, inFlight)) {
    case 'pending':
      return inFlight ? 'Checking that the code scans…' : 'Not verified yet.';
    case 'verified':
      return `Verified — ${report?.decoder ?? 'the decoder'} read it back byte for byte.`;
    case 'refused':
      return report?.reason ?? 'The code could not be verified.';
  }
}

/**
 * What the placement engine decided, in one line: the level and version it chose for the
 * logo, the mask it picked with the knock-out in place, and what the logo costs against what
 * a block can spare.
 *
 * It is the plan made readable, not a verdict — the scan gate is the only thing that says
 * whether a code reads. Null when there is nothing decided to report: no code, no logo, or a
 * plan that refused, which says its own sentence instead.
 */
export function describePlan(plan: Plan): string | null {
  if (!plan.ok || plan.coverage === null) return null;
  return (
    `Level ${plan.ecl}, version ${plan.version}, mask ${plan.mask} — the logo uses ` +
    `${plan.coverage.worst} of ${plan.coverage.budget} codewords a block can spare.`
  );
}

/** One variant the scan margin was measured on, and whether a decoder still read it. */
export interface ScanVariant {
  /** What was done to the code: "Shrunk to 25 %", "Blurred 3 px", "JPEG quality 50". */
  label: string;
  verified: boolean;
}

/**
 * One line of the scan margin: what was done to the code, and whether it still reads.
 *
 * "Reads" and "fails" rather than a tick and a cross, because the word is the meaning and the
 * icon beside it is decoration (DESIGN_SYSTEM §5). The margin is a report and never a gate
 * (ADR-027): a variant that fails says so in a line, and the export button never hears about it.
 */
export function describeVariant({ label, verified }: ScanVariant): string {
  return `${label} — ${verified ? 'reads' : 'fails'}`;
}

/**
 * What a reopened code says about itself (ADR-028).
 *
 * A saved code is its fields and the name of the scene they made, never a stored picture, so
 * the scene is rebuilt on opening and hashed again. Almost always the two digests agree and the
 * sentence says so. When they do not, something between the two renders changed — a newer
 * version of this product drawing the same fields differently — and that is the stated cost of
 * storing fields instead of an image, so it is said out loud rather than discovered on paper.
 */
export function describeReopen(matches: boolean): string {
  return matches
    ? 'Reopened exactly as it was saved.'
    : 'This code rebuilds differently from when it was saved; check it before you print.';
}
