import type { BlockBudget, Prediction } from '@/domain/resilience';
import type { Ecl } from '@/domain/qr/encode';

/**
 * Every sentence the "Where it breaks" card says (P9, ADR-037), in one file so that each one is
 * held by a test rather than by somebody reading the screen.
 *
 * The figures are the domain's — `headroom`, `weakestSpot`, `predictDamage` — and nothing here
 * decides anything about the code. What this file adds is the arithmetic that turns modules into
 * the millimetres a person holding the print can picture, and the words.
 */

/**
 * The share of damage each level is said to survive, as the figure everybody quotes. It is the
 * conventional one on purpose: the sentence sets the code's real figures against the claim a
 * person has already heard, and the claim is these four numbers.
 */
export const LEVEL_FIGURE: Record<Ecl, number> = { L: 7, M: 15, Q: 25, H: 30 };

/**
 * How wide one module prints, quiet zone included in the width: the printed width covers the
 * whole scene, and the scene is `size + 2 × quietZone` modules across.
 */
export function millimetresPerModule(widthMm: number, size: number, quietZone: number): number {
  return widthMm / (size + 2 * quietZone);
}

/**
 * How wide a round smudge of `radius` modules is on paper. The disk is grown around a module's
 * centre, so it covers the centre module and `radius` modules on either side of it.
 */
export function spotDiameterMm(radius: number, mmPerModule: number): number {
  return (2 * radius + 1) * mmPerModule;
}

/** `14 %` — a share as the sentence says it, to the nearest whole per cent. */
function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

/** `4.9 mm` — one decimal, which is as finely as anybody pictures a smudge. */
function millimetres(mm: number): string {
  return `${mm.toFixed(1)} mm`;
}

export interface HeadlineInput {
  ecl: Ecl;
  /** What is left after the logo, spread evenly — `headroom().afterLogo`, a share of 0–1. */
  afterLogo: number;
  /** Whether a logo plate sits on the code. */
  hasLogo: boolean;
  /** The weakest spot's radius in modules, or null when there is none to find. */
  spotRadius: number | null;
  /** The printed width, in millimetres. */
  widthMm: number;
  /** Modules per side of the symbol, quiet zone excluded. */
  size: number;
  quietZone: number;
}

/**
 * The card's one sentence: the figure everybody quotes, what is really left, and the smudge that
 * can stop the code — "can", because the weakest spot is the worst case: a real blot changes fewer
 * modules than every one it covers, and may be survived. Without a logo nothing has been spent, so the clause about what is left is
 * dropped and the claim is qualified instead — it holds only for damage spread perfectly evenly.
 */
export function headline({
  ecl,
  afterLogo,
  hasLogo,
  spotRadius,
  widthMm,
  size,
  quietZone,
}: HeadlineInput): string {
  const claim = `Level ${ecl} is said to survive ${LEVEL_FIGURE[ecl]} % damage`;
  const spot =
    spotRadius === null
      ? null
      : millimetres(spotDiameterMm(spotRadius, millimetresPerModule(widthMm, size, quietZone)));
  if (hasLogo) {
    const left = `With this logo, ${percent(afterLogo)} is left if damage is spread evenly`;
    return spot === null
      ? `${claim}. ${left}.`
      : `${claim}. ${left} — and one smudge ${spot} across, in the right place, can stop it.`;
  }
  return spot === null
    ? `${claim} — spread perfectly evenly.`
    : `${claim} — spread perfectly evenly. One smudge ${spot} across, in the right place, can stop it.`;
}

/** Codewords a block has lost, to the logo and to the damage together. */
function spent(block: BlockBudget): number {
  return block.capacity - block.spare;
}

/** `Block 2 — 6 of 11 spent`. Blocks are counted from one, as a person counts them. */
export function blockLabel(index: number, block: BlockBudget): string {
  return `Block ${index + 1} — ${spent(block)} of ${block.capacity} spent`;
}

/** What the arithmetic says about the damage on the code now. */
export function predictionLine(prediction: Prediction): string {
  switch (prediction.verdict) {
    case 'guaranteed':
      return 'Still guaranteed to read.';
    case 'past-guarantee': {
      const block = prediction.blocks[prediction.weakest];
      // The verdict is only ever past its guarantee because some block is; the fallback is for a
      // broken caller, so that it reads as a wrong sentence and not as one with a hole in it.
      if (block === undefined) return 'Past its guarantee.';
      return (
        `Past its guarantee — block ${prediction.weakest + 1} has lost ${spent(block)} of the ` +
        `${block.capacity} codewords it can correct.`
      );
    }
    case 'decoder-decides':
      return 'A finder or the quiet zone was hit: only a decoder can say.';
  }
}

/** Said while the decoder is being asked. */
export const DECODER_ASKING = 'Asking the decoder…';

/** Said when the decoder could not be asked at all — not an answer, and never worded as one. */
export function decoderFailure(reason: string): string {
  return `The decoder could not be asked. ${reason}`;
}

/**
 * What the decoder made of the damaged print, beside what the arithmetic predicted.
 *
 * A code that reads past its guarantee is not a contradiction, and it is said so: the guarantee
 * counts everything under the logo as lost, and some of it survived. A code that does not read is
 * said in the host's own sentence — "The decoder found no code." or "The decoder read something
 * else." — never in a paraphrase of it.
 */
export function decoderLine(
  report: { reads: boolean; reason: string | null },
  verdict: Prediction['verdict'],
  hasLogo: boolean,
): string {
  if (!report.reads) return report.reason ?? 'The decoder found no code.';
  if (verdict !== 'past-guarantee') return 'The decoder read it.';
  return hasLogo
    ? 'The decoder still read it: some of what the logo covers survived better than the guarantee counts.'
    : 'The decoder still read it, past its guarantee.';
}
