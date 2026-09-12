import { Checkmark16Regular, Dismiss16Regular } from '@fluentui/react-icons';

import { describeVariant, type ScanVariant } from '@/domain/describe';
import { Card } from '@/ui/Card';

/**
 * The scan margin (SPEC §7, ADR-027): how far the code can be degraded and
 * still read.
 *
 * A verdict from the gate is binary — this file decodes — and binary is not the
 * whole truth about paper. A code that only just decodes at full size is one bad
 * photocopy away from failing on a wall, and nothing on screen would have said
 * so. So once a code has passed, it is shrunk, blurred and recompressed, and the
 * nine answers are listed.
 *
 * It is a report and never a gate. Nothing here disables the export button:
 * "Blurred 3 px — fails" is information a person can act on by printing it
 * larger, not a refusal, and treating it as one would be this product deciding
 * something it was not asked to decide.
 *
 * The words carry the answer. The tick and the cross beside them are decoration
 * (DESIGN_SYSTEM §5): a line read aloud, or read by somebody who cannot tell the
 * two colours apart, still says "reads" or "fails".
 */
export function ScanMarginCard({
  variants,
  loading,
  failure,
}: {
  /** The nine answers, or `null` while there are none yet. */
  variants: ScanVariant[] | null;
  loading: boolean;
  /** Why the margin could not be measured, when it could not. Never a refusal. */
  failure: string | null;
}) {
  return (
    <Card title="Scan margin">
      <p className="text-caption text-fg-tertiary">
        {loading
          ? 'Measuring…'
          : failure !== null
            ? failure
            : 'How the code holds up when it is shrunk, blurred and recompressed.'}
      </p>

      {/* No live region of its own: nine lines read out unasked is a live region a
          person turns off, and DESIGN_SYSTEM §7 puts transient news through
          `announce()` — which the screen does, in one sentence, when the
          measurement lands. */}
      {variants !== null && variants.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {variants.map((variant) => (
            <li key={variant.label} className="flex items-center gap-2 text-body text-fg-secondary">
              <span
                aria-hidden="true"
                className={`shrink-0 ${variant.verified ? 'text-success' : 'text-caution'}`}
              >
                {variant.verified ? <Checkmark16Regular /> : <Dismiss16Regular />}
              </span>
              <span>{describeVariant(variant)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
