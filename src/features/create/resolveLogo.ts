/**
 * A stored logo reference back into the logo the editor uses.
 *
 * A saved code and a brand kit keep a logo by its id, its plate and its size — three facts, no
 * bytes. Putting one back on the code means finding it in the store and reading its bytes, which
 * is what this does: once, for both the library's Open and the brand kit's Apply, so the two
 * cannot drift into two different ideas of what "the same logo" means.
 *
 * A reference the store cannot answer is reported rather than dropped. Opening a code without the
 * logo it was saved with would be a different code shown under the saved one's name — the silent
 * degradation DESIGN_SYSTEM §10 forbids — so the caller gets a sentence and shows it.
 */

import { describeError } from '@/data/errors';
import { listLogos, logoDataUrl } from '@/data/logos';
import type { ChosenLogoRef } from '@/domain/library';

import type { ChosenLogo } from './LogoCard';

export type ResolvedLogo = { ok: true; logo: ChosenLogo } | { ok: false; reason: string };

export async function resolveLogo(reference: ChosenLogoRef): Promise<ResolvedLogo> {
  try {
    const stored = await listLogos();
    const info = stored.find((candidate) => candidate.id === reference.id);
    if (info === undefined) {
      return {
        ok: false,
        reason: 'The logo it was saved with is no longer in this workspace.',
      };
    }
    const dataUrl = await logoDataUrl(info.id);
    return {
      ok: true,
      logo: { info: { ...info, dataUrl }, plate: reference.plate, size: reference.size },
    };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  }
}
