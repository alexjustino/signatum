import { Checkmark16Regular, Dismiss16Regular } from '@fluentui/react-icons';

import { describeVariant, type ScanVariant } from '@/domain/describe';
import { Card } from '@/ui/Card';

/**
 * The four print conditions, by the labels the host reports them under (ADR-035). The labels are
 * the contract with the host: it names the variants and this card only sorts them, so a line is
 * placed by what it says rather than by where it came in the list.
 */
const PRINT_LABELS: ReadonlySet<string> = new Set([
  'Ink spread, coated paper',
  'Ink spread, uncoated paper',
  'Tilted 30°',
  'Dim light',
]);

const SCREEN_HEADING = 'On screen and in chat';
const PRINT_HEADING = 'In print';

/**
 * The scan margin (SPEC §7, ADR-027, ADR-035): how far the code can be degraded
 * and still read.
 *
 * A verdict from the gate is binary — this file decodes — and binary is not the
 * whole truth about paper. A code that only just decodes at full size is one bad
 * photocopy away from failing on a wall, and nothing on screen would have said
 * so. So once a code has passed, it is shrunk, blurred and recompressed the way
 * a screen or a chat app would, then spread by ink, tilted and dimmed the way
 * print would, and the thirteen answers are listed in those two groups.
 *
 * It is a report and never a gate. Nothing here disables the export button:
 * "Ink spread, uncoated paper — fails" is information a person can act on by
 * printing it larger or on coated stock, not a refusal, and treating it as one
 * would be this product deciding something it was not asked to decide.
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
  /** The thirteen answers, or `null` while there are none yet. */
  variants: ScanVariant[] | null;
  loading: boolean;
  /** Why the margin could not be measured, when it could not. Never a refusal. */
  failure: string | null;
}) {
  const screen = variants?.filter((variant) => !PRINT_LABELS.has(variant.label)) ?? [];
  const print = variants?.filter((variant) => PRINT_LABELS.has(variant.label)) ?? [];

  return (
    <Card title="Scan margin">
      <p className="text-caption text-fg-tertiary">
        {loading
          ? 'Measuring…'
          : failure !== null
            ? failure
            : 'How the code holds up on a screen, in a chat app and in print.'}
      </p>

      {/* No live region of its own: thirteen lines read out unasked is a live
          region a person turns off, and DESIGN_SYSTEM §7 puts transient news
          through `announce()` — which the screen does, in one sentence, when the
          measurement lands. */}
      {screen.length > 0 && <VariantGroup heading={SCREEN_HEADING} variants={screen} />}
      {print.length > 0 && (
        <VariantGroup
          heading={PRINT_HEADING}
          variants={print}
          caption="Ink spread is a share of a module; the tilt is 30° from square; dim light is a third of the contrast."
        />
      )}
    </Card>
  );
}

/**
 * One group of the margin: a small heading, the list it names, and — for print — a caption that
 * says what the figures in its labels are measured against. The list carries its heading as its
 * accessible name, so a person moving by list hears which group they are in before the lines.
 */
function VariantGroup({
  heading,
  variants,
  caption,
}: {
  heading: string;
  variants: ScanVariant[];
  caption?: string;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <h3 className="text-caption font-semibold text-fg-secondary">{heading}</h3>
      <ul aria-label={heading} className="flex flex-col gap-1">
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
      {caption !== undefined && <p className="text-caption text-fg-tertiary">{caption}</p>}
    </div>
  );
}
