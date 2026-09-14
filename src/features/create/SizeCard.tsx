import { useState } from 'react';

import {
  checkPrintSize,
  DPI_CHOICES,
  formatMillimetres,
  LENGTH_UNIT_LABELS,
  LENGTH_UNITS,
  MAX_PRINT_MM,
  MIN_PRINT_MM,
  MM_PER_INCH,
  moduleMillimetres,
  pixelsFor,
  type LengthUnit,
  type PrintSize,
} from '@/domain/size';
import { Card } from '@/ui/Card';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * The size the code is printed at (SPEC §2.5, F7).
 *
 * Size is an input, not a consequence: every number the export writes — the
 * PNG's pixels and its pixels-per-metre, the SVG's width, the PDF's page —
 * comes from the three controls in this card. So the card shows what they add
 * up to in the one line that matters on paper: how many pixels the raster is,
 * and how wide one module comes out. A person about to print a sticker is
 * deciding about millimetres, and the millimetres are on screen.
 *
 * The card decides nothing. Whether a size is one a code can be printed at is a
 * domain rule with bounds, a raster range and a sentence (`checkPrintSize`) that
 * names the field it is about — so a resolution too fine to render says so under
 * the resolution, and a width nothing is printed at says so under the width. The
 * same sentence is said again at the gate, where every other reason a code
 * cannot leave is said, and the preview goes empty like it does for any other
 * refusal: there is no code at a size nothing can be printed at.
 */
/**
 * What the number field offers per unit: the bounds the domain accepts, and a
 * step a person would actually nudge by — a millimetre, or a tenth of an inch.
 * They are the field's manners, not the rule: the rule is `checkPrintSize`,
 * which is asked whatever arrives in the box.
 *
 * The bounds are the domain's own, rounded the way the domain's refusal words
 * them, so the arrows stop where the sentence says they stop.
 */
const BOUNDS: Record<LengthUnit, { min: number; max: number; step: number }> = {
  mm: { min: MIN_PRINT_MM, max: MAX_PRINT_MM, step: 1 },
  in: {
    min: Number((MIN_PRINT_MM / MM_PER_INCH).toFixed(1)),
    max: Number((MAX_PRINT_MM / MM_PER_INCH).toFixed(1)),
    step: 0.1,
  },
};

export function SizeCard({
  size,
  onSize,
  side,
}: {
  size: PrintSize;
  onSize: (size: PrintSize) => void;
  /**
   * Modules per side of the code on screen, quiet zone included, or `null` when
   * there is no code yet. It is what turns a width into a module size — the one
   * number that decides whether a print scans.
   */
  side: number | null;
}) {
  // What is in the width box while it is being typed.
  //
  // A number field cannot be fed back the number it parsed to: somebody typing
  // "12.5" is briefly holding "12.", which parses to 12, and a box re-rendered
  // as "12" eats the dot and turns the next keystroke into 125. So the text is
  // the card's and the number is the shell's, and the two are committed
  // together — an unparseable box commits "not a number", which is a refusal the
  // domain already has a sentence for, rather than leaving the last good width
  // quietly in force behind an empty field.
  const [typed, setTyped] = useState<string | null>(null);

  const verdict = checkPrintSize(size);
  const pixels = pixelsFor(size);

  // The refusal is shown under the control it is about — the domain names the
  // field, so a sentence about the resolution never appears under the width.
  const widthRefusal = !verdict.ok && verdict.field === 'value' ? verdict.reason : null;
  const dpiRefusal = !verdict.ok && verdict.field === 'dpi' ? verdict.reason : null;

  // What the three controls come to, on paper: the raster and one module. A
  // refused size has no arithmetic worth showing — the reason is the line
  // instead, and it is already under its own field.
  const caption = !verdict.ok
    ? null
    : side === null
      ? `${pixels} × ${pixels} px`
      : `${pixels} × ${pixels} px · modules ${formatMillimetres(moduleMillimetres(side, size))} mm`;

  const bounds = BOUNDS[size.unit];

  return (
    <Card title="Size" description="How large the code is printed, and how finely it is rendered.">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Width</span>
            <Input
              aria-label="Width"
              aria-invalid={!verdict.ok && verdict.field === 'value'}
              type="number"
              inputMode="decimal"
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={typed ?? (Number.isFinite(size.value) ? String(size.value) : '')}
              onChange={(event) => {
                const next = event.target.value;
                setTyped(next);
                onSize({ ...size, value: next.trim() === '' ? Number.NaN : Number(next) });
              }}
            />
            {widthRefusal !== null && (
              <span aria-live="polite" className="text-caption text-danger">
                {widthRefusal}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Unit</span>
            <Select
              aria-label="Unit"
              value={size.unit}
              onChange={(event) => {
                // The strip of options is the only source of a unit; anything
                // else is not an answer, and the millimetre stands.
                const chosen = LENGTH_UNITS.find((unit) => unit === event.target.value);
                onSize({ ...size, unit: chosen ?? 'mm' });
              }}
            >
              {LENGTH_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {LENGTH_UNIT_LABELS[unit]}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Resolution</span>
          <Select
            aria-label="Resolution"
            aria-invalid={!verdict.ok && verdict.field === 'dpi'}
            value={String(size.dpi)}
            onChange={(event) => onSize({ ...size, dpi: Number(event.target.value) })}
          >
            {DPI_CHOICES.map((dpi) => (
              <option key={dpi} value={String(dpi)}>
                {`${dpi} dpi`}
              </option>
            ))}
          </Select>
          {dpiRefusal !== null && (
            <span aria-live="polite" className="text-caption text-danger">
              {dpiRefusal}
            </span>
          )}
        </label>

        {/* One line for what the controls come to: how many pixels the raster is,
            and how wide a module lands on paper. It is arithmetic rather than a
            verdict, so it is never coloured like one; the verdicts are under the
            fields they belong to (DESIGN_SYSTEM §10). */}
        <p className="min-h-5 text-caption text-fg-secondary">{caption}</p>
      </div>
    </Card>
  );
}
