/**
 * How to make a code tougher, and what each way costs (P10, ADR-038).
 *
 * "Where it breaks" says how small a smudge can stop this code. The next question is what to
 * change, and every answer costs something a person can see: a smaller logo is less brand, a higher
 * level a denser code, a link without its tracking parameters a campaign nobody can measure, a
 * larger print more paper. This puts the changes this screen can make side by side, each planned for
 * real by the placement engine and measured the way the card measures — the smudge, in millimetres
 * of the print — and keeps only those that make the code tougher.
 *
 * Nothing is decided here. Each row is the engine's plan for that change and the smudge is the one
 * `resilience` finds; this asks for them, compares them with the code on screen, and says which
 * way each moves.
 */

import type { EclFloor } from '@/domain/library';
import { LOGO_SIZES, LOGO_SIZE_LABELS, type LogoSize } from '@/domain/logo';
import { plateOf } from '@/domain/placement';
import type { Ecl } from '@/domain/qr/encode';
import { weakestSpot } from '@/domain/resilience';
import { MAX_PRINT_MM, formatMillimetres } from '@/domain/size';
import { withoutTracking } from '@/domain/tracking';

import { millimetresPerModule, spotDiameterMm } from './breakSentences';
import { ECL, PLATE_PADDING, planFor } from './plan';

/** The levels a person may ask for, named as the Look card names them. */
const FLOORS: ReadonlyArray<{ floor: EclFloor; label: string }> = [
  { floor: 'M', label: 'At least M' },
  { floor: 'Q', label: 'At least Q' },
  { floor: 'H', label: 'Level H' },
];

/** The widths the larger-print row steps through, in millimetres — the proof sheet's and on. */
const PRINT_STEPS_MM: readonly number[] = [15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];

/** What one row changes on the screen when it is used. */
export type ToughnessChoice =
  { logoSize: LogoSize } | { ecl: EclFloor } | { url: string } | { widthMm: number };

/** One code, planned and measured. */
export interface Measured {
  ecl: Ecl;
  version: number;
  /** Modules per side, quiet zone excluded. */
  size: number;
  /** How wide one module prints, in millimetres. */
  moduleMm: number;
  /** How wide the logo prints, in millimetres; null without a logo. */
  logoMm: number | null;
  /** How wide a smudge can stop it, in millimetres; null when no spot can. */
  smudgeMm: number | null;
}

export interface ToughnessOption extends Measured {
  /** Stable for React and for the end-to-end suite: `tracking`, `logo-small`, `level-Q`, `print`. */
  key: string;
  /** What the row changes, in the screen's words. */
  label: string;
  /** What the change gives up, in one clause. */
  cost: string;
  choice: ToughnessChoice;
}

export interface Toughness {
  /** The code on screen, measured. */
  now: Measured;
  /** The changes that make it tougher, toughest first. */
  options: ToughnessOption[];
}

export interface ToughnessRequest {
  /** What the code carries now. */
  payload: string;
  /** The link as typed, when the code is a link; tracking parameters are looked for in it. */
  link: string | null;
  /** The logo's size on screen, or null for a code without one. */
  logoSize: LogoSize | null;
  quietZone: number;
  /** The level a person asked for, or undefined while the engine decides. */
  ecl: EclFloor | undefined;
  /** The printed width, in millimetres. */
  widthMm: number;
}

/** Plan one code and measure it at a printed width; null when the engine refuses it. */
export function measure(
  payload: string,
  {
    logoSize,
    quietZone,
    ecl,
    widthMm,
  }: Pick<ToughnessRequest, 'logoSize' | 'quietZone' | 'ecl' | 'widthMm'>,
): Measured | null {
  const plan = planFor(payload, { logoSize, quietZone, ecl });
  if (!plan.ok) return null;
  const plate = plan.box === null ? null : plateOf(plan.box, PLATE_PADDING);
  const moduleMm = millimetresPerModule(widthMm, plan.matrix.size, quietZone);
  const spot = weakestSpot(plan.matrix, plate, quietZone);
  return {
    ecl: plan.ecl,
    version: plan.version,
    size: plan.matrix.size,
    moduleMm,
    logoMm: plan.box === null ? null : plan.box.width * moduleMm,
    smudgeMm: spot === null ? null : spotDiameterMm(spot.radius, moduleMm),
  };
}

/** The next printed width the larger-print row offers, or null past the last step. */
export function nextPrintWidth(widthMm: number): number | null {
  const next = PRINT_STEPS_MM.find((step) => step > widthMm + 0.05);
  return next === undefined || next > MAX_PRINT_MM ? null : next;
}

/**
 * A change is worth offering when it asks for a smudge at least a tenth of a millimetre larger —
 * the precision the card prints. A change that leaves the number where it was is not tougher, and
 * a row that says so would be noise.
 */
function tougher(option: Measured, now: Measured): boolean {
  if (option.smudgeMm === null || now.smudgeMm === null) return false;
  return option.smudgeMm >= now.smudgeMm + 0.1;
}

/**
 * The code on screen and the changes that make it tougher, each planned and measured. A change the
 * engine refuses — a level this content will not fit at — is left out, and so is one that does not
 * move the smudge.
 */
export function toughnessOptions(request: ToughnessRequest): Toughness | null {
  const { payload, link, logoSize, quietZone, ecl, widthMm } = request;
  const settings = { logoSize, quietZone, ecl, widthMm };
  const now = measure(payload, settings);
  if (now === null) return null;
  const candidates: ToughnessOption[] = [];

  const cleaned = link === null ? null : withoutTracking(link);
  if (cleaned !== null) {
    // The payload is the link as the builder writes it; the cleaned link goes through the same
    // builder on screen, so here it is measured as the text it will become.
    const measured = measure(cleaned.url, settings);
    if (measured !== null) {
      candidates.push({
        key: 'tracking',
        label: `Without its tracking parameters (${cleaned.removed.join(', ')})`,
        cost: 'the site can no longer tell which campaign a scan came from',
        choice: { url: cleaned.url },
        ...measured,
      });
    }
  }

  if (logoSize !== null) {
    for (const size of LOGO_SIZES) {
      if (size === logoSize) continue;
      const measured = measure(payload, { ...settings, logoSize: size });
      if (measured === null) continue;
      candidates.push({
        key: `logo-${size}`,
        label: `A ${LOGO_SIZE_LABELS[size].toLowerCase()} logo`,
        cost:
          measured.logoMm === null || now.logoMm === null
            ? 'a smaller mark'
            : `the mark prints ${measured.logoMm.toFixed(1)} mm wide instead of ${now.logoMm.toFixed(1)} mm`,
        choice: { logoSize: size },
        ...measured,
      });
    }
  } else {
    const asked = ecl ?? ECL;
    for (const { floor, label } of FLOORS) {
      if (floor === asked) continue;
      const measured = measure(payload, { ...settings, ecl: floor });
      if (measured === null || measured.ecl === now.ecl) continue;
      candidates.push({
        key: `level-${floor}`,
        label,
        cost: `a denser code: modules ${measured.moduleMm.toFixed(2)} mm instead of ${now.moduleMm.toFixed(2)} mm`,
        choice: { ecl: floor },
        ...measured,
      });
    }
  }

  const wider = nextPrintWidth(widthMm);
  if (wider !== null) {
    const measured = measure(payload, { ...settings, widthMm: wider });
    if (measured !== null) {
      candidates.push({
        key: 'print',
        label: `Printed ${wider} mm wide`,
        cost: `${formatMillimetres(wider - widthMm)} mm more paper each way`,
        choice: { widthMm: wider },
        ...measured,
      });
    }
  }

  // Two changes that end in the same code are one row: asking for Q where the engine already
  // raises the level to H plans the same symbol as asking for H, and only the first is kept.
  const seen = new Set<string>();
  const options = candidates
    .filter((option) => tougher(option, now))
    .filter((option) => {
      const same = `${option.version}${option.ecl}|${option.logoMm}|${option.moduleMm}`;
      if (seen.has(same)) return false;
      seen.add(same);
      return true;
    })
    .sort((a, b) => (b.smudgeMm ?? 0) - (a.smudgeMm ?? 0));
  return { now, options };
}

/** `4.9 mm` — the card's own precision. */
function mm(value: number | null): string {
  return value === null ? 'no smudge' : `${value.toFixed(1)} mm`;
}

/** What the code on screen is now, in the same words every row uses. */
export function nowLine(now: Measured): string {
  return now.smudgeMm === null
    ? `Now: version ${now.version}, level ${now.ecl}.`
    : `Now: version ${now.version}, level ${now.ecl} — a smudge ${mm(now.smudgeMm)} across can stop it.`;
}

/** One row's line: what the code becomes, and what the change gives up. */
export function optionLine(option: ToughnessOption, now: Measured): string {
  return `Version ${option.version}, level ${option.ecl} — a smudge ${mm(option.smudgeMm)} across instead of ${mm(now.smudgeMm)} can stop it; ${option.cost}.`;
}
