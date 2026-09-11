/**
 * The sentences the product says about a code, decided once and shared by the screen, the
 * accessible names and the end-to-end suite — so that two readings of one fact agree.
 */

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
