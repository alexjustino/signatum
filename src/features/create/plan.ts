/**
 * The recipe for one code: from an accepted payload to the scene that is drawn, decoded and
 * exported.
 *
 * It lives beside the Create screen rather than inside it because the library draws the same
 * code from the same stored fields, and F8's promise is that reopening a saved code rebuilds the
 * *identical* scene — hashed, not eyeballed (ADR-028). Two screens with two copies of this
 * recipe would be two scenes that agree until somebody edits one of them, so there is one copy
 * and both screens call it.
 *
 * Nothing here decides anything the domain decides: the level, the version, the mask and the
 * logo's box are the placement engine's, the SVG is the scene's, and the refusals are theirs
 * too. This module only knows *which* arguments this product hands them.
 */

import type { EclFloor } from '@/domain/library';
import { logoFraction, type LogoSize, type Plate } from '@/domain/logo';
import { planCode, type Plan } from '@/domain/placement';
import type { Ecl } from '@/domain/qr/encode';
import { renderScene, type Style } from '@/domain/scene';

/**
 * The error-correction level for a code with nothing in the middle of it, when nobody has asked
 * for more. `M` is the ordinary choice.
 *
 * A code that carries a logo is not decided here at all: the placement engine starts at `H`, the
 * highest, because something is about to cover modules the decoder still has to do without, and
 * falls back to `Q` only when the content will not fit at `H` (spec §2.4). What a person may
 * choose in the Look card is a *floor*, never a ceiling — the engine's own choice can only be
 * raised, so nobody can trade away the thing that makes their code survive the logo.
 */
export const ECL: Ecl = 'M';

/**
 * Modules of plate around the logo on every side. One module is what separates the mark from the
 * modules it sits among; the engine charges it to the error-correction budget like everything
 * else under the plate.
 */
export const PLATE_PADDING = 1;

/**
 * The whole decision about one code, made in one place in the domain: the level, the version,
 * the mask, and — with a logo — the box the logo may have. The caller asks once and is told
 * everything, including "no": a logo this content cannot carry comes back as a refusal with the
 * sentence to show, never as a smaller logo nobody asked for.
 */
export function planFor(
  payload: string,
  {
    logoSize,
    quietZone,
    ecl,
  }: { logoSize: LogoSize | null; quietZone: number; ecl: EclFloor | undefined },
): Plan {
  if (logoSize === null) {
    return planCode(payload, {
      logo: false,
      // Without a logo the floor is the level, and `M` is the ordinary choice for a code with
      // nothing covering it.
      ecl: ecl ?? ECL,
      quietZone,
    });
  }
  const fraction = logoFraction(logoSize);
  return planCode(payload, {
    logo: true,
    quietZone,
    padding: PLATE_PADDING,
    // Left out when nobody chose one: the engine starts at H with a logo and never goes below
    // Q, and a floor passed here can only raise that.
    ...(ecl === undefined ? {} : { ecl }),
    // Left out rather than passed as nothing: "Largest" is the absence of a limit, and the
    // engine reads a missing share as "as large as the budget allows".
    ...(fraction === undefined ? {} : { fraction }),
  });
}

/** The scene, or the sentence that says why there is none. */
export type Rendered =
  { svg: string; side: number; failure: null } | { svg: null; side: null; failure: string };

/**
 * The scene for a plan that was accepted: the SVG the preview draws, the decoder is asked about
 * and the export writes — one artefact, checked once.
 *
 * The matrix is the plan's own, with the modules under the plate already knocked out, so no
 * half-module shows at the logo's edge. The plate is drawn in the background colour: a logo sits
 * in a clearing of the colour the code is printed on, not of a colour nobody chose.
 */
export function sceneFor(
  plan: Extract<Plan, { ok: true }>,
  style: Style,
  name: string,
  plate: Plate | null,
): Rendered {
  try {
    const rendered = renderScene(
      plan.matrix,
      style,
      name,
      plate !== null && plan.box !== null
        ? { box: plan.box, plate, padding: PLATE_PADDING, colour: style.background }
        : undefined,
    );
    return { svg: rendered.svg, side: rendered.side, failure: null };
  } catch (error) {
    return {
      svg: null,
      side: null,
      failure: error instanceof Error ? error.message : 'This could not be made into a code.',
    };
  }
}
