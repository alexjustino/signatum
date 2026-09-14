import { useState } from 'react';

import type { EclFloor } from '@/domain/library';
import { DEFAULT_STYLE, isColour, type Style } from '@/domain/scene';
import {
  contrastRatio,
  FINDER_SHAPE_LABELS,
  FINDER_SHAPES,
  MODULE_SHAPE_LABELS,
  MODULE_SHAPES,
  quietZoneWarning,
  type FinderShape,
  type ModuleShape,
} from '@/domain/style';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FIELD_CHROME } from '@/ui/fieldSurface';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * The look of the code (SPEC §2.5, F6): its two colours, the shape of its
 * modules and finders, and the blank margin around it.
 *
 * Everything in this card is about ink rather than about the screen. The
 * colours here are the ones the code will be printed in, so they are shown as
 * themselves and never as theme tokens (DESIGN_SYSTEM §2, "Colour and the
 * code") — the chrome around them is themed, the two swatches are not.
 *
 * The card decides nothing. Whether a pair of colours can be read by a camera
 * is a domain rule with a threshold, and the sentence that refuses them is the
 * domain's; this card shows the ratio and hands the style up. The refusal
 * itself belongs beside the export button, where every other reason a code
 * cannot leave is said.
 */

/**
 * The margins worth offering, in modules. Four is what the standard asks for
 * and the only one that needs no warning; the rest are there because a person
 * laying out a card sometimes has nothing to spare, and each of them says what
 * it costs.
 */
const QUIET_ZONES: ReadonlyArray<{ modules: number; label: string }> = [
  { modules: 4, label: '4 modules (standard)' },
  { modules: 2, label: '2 modules' },
  { modules: 1, label: '1 module' },
  { modules: 0, label: 'None' },
];

/**
 * The margins on offer, and the one in force when it is not one of them.
 *
 * The scene will draw any whole number of modules from 0 to 16, so a quiet zone can arrive here
 * from somewhere this card never offered it: a workspace default, a saved code, a brand kit. A
 * `Select` whose value matches no option renders empty — a control that shows nothing about the
 * code it is describing — so the value in force is always one of the options, named the way the
 * others are.
 */
function zonesFor(quietZone: number): ReadonlyArray<{ modules: number; label: string }> {
  if (QUIET_ZONES.some((option) => option.modules === quietZone)) return QUIET_ZONES;
  const label = quietZone === 1 ? '1 module' : `${quietZone} modules`;
  return [...QUIET_ZONES, { modules: quietZone, label }].sort((a, b) => b.modules - a.modules);
}

/** The two colours of a code, by the name the style gives them. */
type ColourKey = 'foreground' | 'background';

/**
 * The lowest error-correction level a person will accept, when they would
 * rather decide than be decided for (SPEC §2.4). It is a floor and only a
 * floor: the engine may go higher — with a logo it starts at H — and `L` is not
 * offered at all, because a level that leaves a code with almost no redundancy
 * is not a choice this product hands to somebody printing one.
 *
 * The type is the domain's — the library stores it, so it is declared where the
 * thing that is stored is declared — and re-exported here because this card is
 * where a person meets it.
 */
export type { EclFloor };

/**
 * The levels, as a person meets them. "Automatic" is the absence of a floor:
 * the engine takes `M` for a plain code and starts at `H` when a logo is about
 * to cover modules the decoder still has to do without.
 */
const ECL_FLOORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: 'Automatic' },
  { value: 'M', label: 'At least M' },
  { value: 'Q', label: 'At least Q' },
  { value: 'H', label: 'H' },
];

export function LookCard({
  style,
  onStyle,
  ecl,
  onEcl,
}: {
  style: Style;
  onStyle: (style: Style) => void;
  /** The floor a person chose, or `undefined` while the engine decides. */
  ecl: EclFloor | undefined;
  onEcl: (ecl: EclFloor | undefined) => void;
}) {
  const ratio = contrastRatio(style.foreground, style.background);
  const quietZone = quietZoneWarning(style.quietZone);

  // What has been typed into a hex box but is not a colour yet. A half-typed
  // `#1a2` must not repaint the code — committing it would re-run the scan gate
  // about something nobody asked for — so it is held here until the sixth digit
  // arrives, and dropped the moment the style is the answer.
  //
  // It lives beside the style rather than inside the field because every path
  // that changes a colour passes through this card: the box, the swatch and
  // "Reset look" all clear the draft they replace, so the field never needs an
  // effect to notice that it was overtaken.
  const [typed, setTyped] = useState<Partial<Record<ColourKey, string>>>({});

  const edit = (key: ColourKey, next: string) => {
    if (isColour(next)) {
      setTyped((all) => ({ ...all, [key]: undefined }));
      // Lower case is what the scene writes into the SVG; the field agrees with
      // the file rather than showing a spelling that will not survive the export.
      onStyle({ ...style, [key]: next.toLowerCase() });
      return;
    }
    setTyped((all) => ({ ...all, [key]: next }));
  };

  const reset = () => {
    setTyped({});
    onStyle(DEFAULT_STYLE);
    onEcl(undefined);
  };

  return (
    <Card
      title="Look"
      description="How the code is printed. The colours here are the ink, not the application's theme."
    >
      <div className="flex flex-col gap-3">
        <ColourField
          label="Code colour"
          colour={style.foreground}
          text={typed.foreground ?? style.foreground}
          onText={(next) => edit('foreground', next)}
        />
        <ColourField
          label="Background"
          colour={style.background}
          text={typed.background ?? style.background}
          onText={(next) => edit('background', next)}
        />

        <p className="text-caption text-fg-secondary">
          Contrast{' '}
          <span data-selectable className="font-mono">
            {ratio.toFixed(1)}
          </span>{' '}
          : 1
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Modules</span>
            <Select
              aria-label="Modules"
              value={style.moduleShape ?? 'square'}
              onChange={(event) =>
                onStyle({ ...style, moduleShape: event.target.value as ModuleShape })
              }
            >
              {MODULE_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {MODULE_SHAPE_LABELS[shape]}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Finders</span>
            <Select
              aria-label="Finders"
              value={style.finderShape ?? 'square'}
              onChange={(event) =>
                onStyle({ ...style, finderShape: event.target.value as FinderShape })
              }
            >
              {FINDER_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {FINDER_SHAPE_LABELS[shape]}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Quiet zone</span>
          <Select
            aria-label="Quiet zone"
            value={String(style.quietZone)}
            onChange={(event) => onStyle({ ...style, quietZone: Number(event.target.value) })}
          >
            {zonesFor(style.quietZone).map((option) => (
              <option key={option.modules} value={String(option.modules)}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        {/* A warning that appeared beside every code would teach nothing
            (DESIGN_SYSTEM §2): it is here only when the margin really is under
            what a camera needs. */}
        {quietZone !== null && (
          <InfoBar severity="caution" title="Quiet zone">
            {quietZone}
          </InfoBar>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Error correction</span>
          <Select
            aria-label="Error correction"
            value={ecl ?? 'auto'}
            onChange={(event) => {
              // "Automatic" is the absence of a floor, and the only other
              // answers are the three levels this product offers.
              const chosen = event.target.value;
              onEcl(chosen === 'M' || chosen === 'Q' || chosen === 'H' ? chosen : undefined);
            }}
          >
            {ECL_FLOORS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        <div>
          <Button appearance="subtle" onClick={reset}>
            Reset look
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * One colour, as the two controls people reach for: the swatch for picking and
 * the hex box for pasting a brand colour somebody was given in writing.
 *
 * The field holds nothing. What is typed is the card's, so that a colour
 * changed from anywhere — the swatch, "Reset look" — is the one on screen, and
 * an invalid hex is visibly invalid without anything being committed.
 */
function ColourField({
  label,
  colour,
  text,
  onText,
}: {
  label: string;
  /** The committed colour: always a six-digit hex, and what the swatch shows. */
  colour: string;
  /** What the hex box shows — the committed colour, or what is being typed. */
  text: string;
  onText: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">{label}</span>
      <span className="flex items-stretch gap-2">
        {/* The swatch's own colour is the person's print colour, which is the
            one place in the product where a value is not a token (§2). Its
            border, fill and focus are the field's, so it and the hex box read
            as one control — one height, one baseline, one edge. The colour
            fills it rather than floating inside it: the browser's own inset is
            flattened in `global.css`, and `overflow-hidden` keeps the fill
            inside the field's corners. */}
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={colour}
          className={[
            'h-(--density-control) w-10 shrink-0 cursor-pointer overflow-hidden p-0',
            FIELD_CHROME,
          ].join(' ')}
          onChange={(event) => onText(event.target.value)}
        />
        <Input
          aria-label={label}
          aria-invalid={!isColour(text)}
          value={text}
          placeholder="#000000"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          className="font-mono"
          onChange={(event) => onText(event.target.value)}
        />
      </span>
    </label>
  );
}
