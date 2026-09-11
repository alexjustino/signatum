/**
 * The sentences the product says about a code, decided once and shared by the screen, the
 * accessible names and the end-to-end suite — so that two readings of one fact agree.
 */

import { describeLink } from './payload/link';

/** The accessible name of the preview figure: "QR code that opens example.com". */
export function describeCode(url: string): string {
  const action = describeLink(url);
  return `QR code that ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
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
