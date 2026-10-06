import type { StampCheck } from '@/data/read';
import type { Severity } from '@/ui/InfoBar';

/**
 * What the Stamp card says about a file (P2): exactly one of five sentences, and its tone.
 *
 * The order of the questions is the order of what can be trusted. No stamp, and there is nothing
 * else to ask. A stamp the file no longer matches says nothing true about this file — whatever
 * row it names was about the file before it was changed — so "changed" is said before anything
 * about the workspace. Only an unchanged file is then looked up: a matching row here is this
 * workspace's own word, with the date from that row; a reference held here under a different
 * digest is a stamp on some other file; and a reference this workspace never issued is a stamp
 * from elsewhere, reported as exactly that, because anyone can write a stamp.
 */

export interface StampSentence {
  severity: Severity;
  /** The one sentence, whole. */
  sentence: string;
  /** A second sentence under it, when the first one needs it. */
  detail: string | null;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * `14 Sep 2026` — the day this workspace verified the file, in the reader's own time zone.
 *
 * Written out rather than asked of `Intl`, because the locale data under `en-GB` now spells the
 * ninth month `Sept`, and a date that changes with the runtime's library is a sentence a test
 * cannot hold. Null when the workspace's text is not a date: a day this screen made up would be
 * worse than none.
 */
export function stampDay(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

export function stampSentence(check: StampCheck): StampSentence {
  if (!check.stamped) {
    return {
      severity: 'info',
      sentence: 'This file carries no Signatum stamp.',
      detail: 'Files exported by Signatum 1.1 or later carry one, unless stamping was turned off.',
    };
  }
  if (!check.intact) {
    return {
      severity: 'caution',
      sentence: 'Carries a Signatum stamp, but the file was changed after it was verified.',
      detail: null,
    };
  }
  // The host always names the decoder when there is a stamp; the fallback is for a broken host,
  // so that it is a wrong-looking sentence and not a sentence with a hole in it.
  const decoder = check.decoder ?? 'an unnamed decoder';
  if (check.matchesRecord) {
    const day = check.verifiedAt === null ? null : stampDay(check.verifiedAt);
    return {
      severity: 'success',
      sentence: `Verified by this workspace${day === null ? '' : ` on ${day}`}, by ${decoder} — unchanged since.`,
      detail: null,
    };
  }
  if (check.inWorkspace) {
    return {
      severity: 'caution',
      sentence: 'This workspace verified a different file under this stamp.',
      detail: null,
    };
  }
  return {
    severity: 'info',
    sentence: `Carries a Signatum stamp from another workspace: read back by ${decoder}, and unchanged since. When and where it was verified is known only to the workspace that made it.`,
    detail: null,
  };
}
