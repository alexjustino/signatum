import type { BlockBudget } from '@/domain/resilience';
import type { Ecl } from '@/domain/qr/encode';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { CodePreview, type CodeOverlay } from '@/ui/CodePreview';

import {
  blockLabel,
  DECODER_ASKING,
  decoderFailure,
  decoderLine,
  headline,
  predictionLine,
} from './breakSentences';
import type { Brush, BreakTest } from './useBreakTest';
import { WeakSpotOverlay } from './WeakSpotOverlay';

const TITLE = 'Where it breaks';
const SHOW_LABEL = 'Show the weak spots';
const BRUSHES: readonly Brush[] = ['ink', 'paper'];
const BRUSH_LABELS: Record<Brush, string> = { ink: 'Ink', paper: 'Paper' };

/**
 * Where the code breaks (P9, ADR-037): the place a smudge stops it, and a way to try.
 *
 * "Level H survives 30 % damage" is true only of damage spread perfectly evenly. Reed–Solomon
 * corrects each block on its own and a logo has already spent part of every block it sits on, so
 * a code has a weakest place, and this card says where — in one sentence, in millimetres of the
 * print, with the blocks listed underneath and the weak spots drawn, on request, over the card's
 * own copy of the code.
 *
 * Then it lets a person try: smudge the weakest spot, or draw ink and paper on the code, and see
 * two answers side by side — what the arithmetic guarantees, and what the decoder actually made
 * of the damaged picture. They can disagree in one direction only: the guarantee counts
 * everything under the logo as lost, and a decoder sometimes reads past it.
 *
 * It is a report and never a gate, like the scan margin above it: nothing here disables the
 * export, changes the verdict, or is saved. The overlay is decorative and the sentence carries
 * the meaning (DESIGN_SYSTEM §8); everything but freehand drawing is reachable by keyboard, and
 * the weakest-spot button is the same experiment without a pointer.
 */
export function BreakCard({
  test,
  svg,
  logo,
  side,
  ecl,
  hasLogo,
  widthMm,
  size,
  quietZone,
}: {
  test: BreakTest;
  /** The scene the gate verified, drawn again here as the surface to break. */
  svg: string;
  /** The logo over it, as the main preview draws it. */
  logo: CodeOverlay | undefined;
  /** The scene's side in modules, quiet zone included. */
  side: number;
  ecl: Ecl;
  hasLogo: boolean;
  /** The printed width, in millimetres — what the smudge is measured against. */
  widthMm: number;
  /** Modules per side of the symbol, quiet zone excluded. */
  size: number;
  quietZone: number;
}) {
  const { analysis, blocks, prediction, answer, cells } = test;
  // Create renders the card only once there is an analysis; this is for the type.
  if (analysis === null) return null;

  const sentence = headline({
    ecl,
    afterLogo: analysis.headroom.afterLogo,
    hasLogo,
    spotRadius: analysis.spot?.radius ?? null,
    widthMm,
    size,
    quietZone,
  });
  const verdict = prediction?.verdict ?? 'guaranteed';
  const predicted = prediction === null ? 'Still guaranteed to read.' : predictionLine(prediction);
  const decoder =
    answer === null
      ? null
      : answer.pending
        ? DECODER_ASKING
        : answer.failure !== null
          ? decoderFailure(answer.failure)
          : answer.report !== null
            ? decoderLine(answer.report, verdict, hasLogo)
            : null;

  return (
    <Card label={TITLE} title={TITLE}>
      <p className="text-body text-fg-secondary">{sentence}</p>

      <label className="mt-3 flex items-center gap-2">
        <Checkbox label={SHOW_LABEL} checked={test.shown} onChange={test.setShown} />
        <span className="text-body text-fg">{SHOW_LABEL}</span>
      </label>

      {/* Its own copy of the code, not the preview above: the weak spots and the damage are drawn
          where the controls are, and the preview of what will be exported never shows damage that
          is not in the file. */}
      <div className="mt-3">
        <CodePreview
          framed={false}
          name="The code, to try to break"
          svg={svg}
          overlay={logo}
          layer={
            <WeakSpotOverlay
              side={side}
              quietZone={quietZone}
              paths={analysis.paths}
              blocks={blocks}
              spot={analysis.spot}
              cells={cells}
              showWeakSpots={test.shown}
              drawing={test.drawing}
              onPaint={test.paint}
              onStroke={test.setStroking}
            />
          }
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <h3 className="text-caption font-semibold text-fg-secondary">Blocks</h3>
        <ul aria-label="Error-correction blocks" className="flex flex-col gap-2">
          {blocks.map((block, index) => (
            <li key={index} className="flex flex-col gap-1">
              <span className="text-caption text-fg-secondary">{blockLabel(index, block)}</span>
              <BlockBar block={block} />
            </li>
          ))}
        </ul>
        <BarLegend hasLogo={hasLogo} />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <h3 className="text-caption font-semibold text-fg-secondary">Try to break it</h3>
        {/* Four peers in two even rows rather than a row that wraps (DESIGN_SYSTEM §4). */}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={analysis.spot === null} onClick={test.smudge}>
            Smudge the weakest spot
          </Button>
          <Button
            aria-pressed={test.drawing}
            appearance={test.drawing ? 'accent' : 'standard'}
            onClick={() => test.setDrawing(!test.drawing)}
          >
            Draw
          </Button>
          <Button disabled={answer?.pending === true} onClick={test.ask}>
            Ask the decoder
          </Button>
          <Button disabled={cells.length === 0 && answer === null} onClick={test.clear}>
            Clear
          </Button>
        </div>
        <ChoiceGroup
          label="Brush"
          options={BRUSHES}
          value={test.brush}
          onChange={test.setBrush}
          labels={BRUSH_LABELS}
        />
        <p className="text-caption text-fg-tertiary">
          {test.drawing
            ? 'Drag over the code to paint modules. Press Draw again to stop.'
            : 'Draw paints modules on the code with a pointer; the weakest spot needs none.'}
        </p>
      </div>

      {/* Both answers in one line, the arithmetic's and then the decoder's, so a person reads
          them side by side. The contract with the end-to-end suite is this live region. While a
          stroke is being drawn it is busy: the text follows every cell on screen, and assistive
          technology hears it once, when the stroke ends, rather than once per module. */}
      <p aria-live="polite" aria-busy={test.stroking} className="mt-3 text-body text-fg">
        <span>{predicted}</span>
        {decoder !== null && <span>{` ${decoder}`}</span>}
      </p>
    </Card>
  );
}

/** A share of a block's capacity, as a width. Geometry, not design. */
function share(part: number, capacity: number): string {
  return `${(part / capacity) * 100}%`;
}

/**
 * One block as a stacked bar of what it can correct: the logo's share, the damage's, and what is
 * left. Decorative — the label above it says the same thing in words, and the two never disagree
 * because both are drawn from the one budget (DESIGN_SYSTEM §2, "two readings of one fact").
 */
function BlockBar({ block }: { block: BlockBudget }) {
  const capacity = Math.max(1, block.capacity);
  // Past its guarantee, the bar is full: the logo's share first, then the damage up to the end.
  const logo = Math.min(block.logo, capacity);
  const damage = Math.min(block.damage, capacity - logo);
  const spare = Math.max(0, capacity - logo - damage);
  return (
    <div
      aria-hidden="true"
      className="flex h-2 w-full overflow-hidden rounded-sm border border-stroke-subtle bg-layer-alt"
    >
      <span className="block h-full bg-stroke-strong" style={{ width: share(logo, capacity) }} />
      <span className="block h-full bg-danger" style={{ width: share(damage, capacity) }} />
      <span className="block h-full bg-success" style={{ width: share(spare, capacity) }} />
    </div>
  );
}

/**
 * What the segments are, in words beside a swatch of each. Without a logo there is no logo
 * segment, and a legend naming one would be a mark that is never on (DESIGN_SYSTEM §2).
 */
function BarLegend({ hasLogo }: { hasLogo: boolean }) {
  const items = [
    ...(hasLogo ? [{ label: 'Logo', swatch: 'bg-stroke-strong' }] : []),
    { label: 'Damage', swatch: 'bg-danger' },
    { label: 'Spare', swatch: 'bg-success' },
  ];
  return (
    <p className="mt-1 flex gap-3 text-caption text-fg-tertiary">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={`inline-block size-2 rounded-sm ${item.swatch}`} />
          {item.label}
        </span>
      ))}
    </p>
  );
}
