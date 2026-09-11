import { useEffect, useRef } from 'react';

import { describeGate, gateState, type GateReport, type GateState } from '@/domain/describe';

import { announce } from './announce';
import { InfoBar } from './InfoBar';

/**
 * The scan gate, as the person sees it (DESIGN_SYSTEM §8).
 *
 * Three states and no fourth: **verified**, **not verified yet**, **refused** —
 * and refused always carries its reason in a sentence. It is the export
 * button's gate rather than a decoration: the caller reads the same
 * `gateState` to decide whether that button is disabled, and this sits beside
 * the button, so a disabled control never lacks the sentence that explains it
 * (DESIGN_SYSTEM §10).
 *
 * It never shows a state that did not come back from a decoder. A code being
 * checked is "not verified yet", not "probably fine". The words are the
 * domain's, so the status, the announcement and the end-to-end suite are three
 * readings of one fact.
 */
export function ScanGateStatus({
  report,
  inFlight,
}: {
  report: GateReport | null;
  inFlight: boolean;
}) {
  const state = gateState(report, inFlight);

  // A verification that finishes is announced, with its outcome. "Not verified
  // yet" is not announced: it is true after every keystroke, and a live region
  // that repeats itself all day is one a person turns off.
  const announced = useRef<GateState>(state);
  useEffect(() => {
    if (state !== announced.current && state !== 'pending') {
      announce(describeGate(report, inFlight));
    }
    announced.current = state;
  }, [state, report, inFlight]);

  if (state === 'verified' && report !== null) {
    return (
      <InfoBar severity="success" title="Verified">
        {report.decoder} read it back byte for byte.
      </InfoBar>
    );
  }

  if (state === 'refused' && report !== null) {
    return (
      <InfoBar severity="danger" title="Refused">
        {report.reason ?? 'The code could not be verified.'}
      </InfoBar>
    );
  }

  return (
    <InfoBar severity="info" title="Not verified yet">
      {inFlight
        ? 'Checking that the code scans…'
        : 'Nothing is exported until a decoder reads the code back as the link.'}
    </InfoBar>
  );
}
