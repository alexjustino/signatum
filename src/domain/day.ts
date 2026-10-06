/**
 * A day the way every screen of this product writes it: `14 Sep 2026`, in the reader's own time
 * zone. One format everywhere, so a date on the Library and a date on Read say the same thing —
 * and never `10/5/2026`, which half the world reads as the tenth of May.
 *
 * Written out rather than asked of `Intl`, because the locale data under `en-GB` now spells the
 * ninth month `Sept`, and a date that changes with the runtime's library is a sentence a test
 * cannot hold. Null when the text is not a date: a day a screen made up would be worse than none.
 */

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

export function formatDay(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}
