/**
 * Tracking parameters in a link, and the link without them (P10).
 *
 * A link copied from a campaign, an advert or a social network often carries parameters that do
 * nothing for the page — `utm_source`, `fbclid`, `gclid` — and say only where the click came from.
 * In a printed code they cost twice: every character makes the symbol denser, so the code needs
 * a higher version and its modules print smaller; and every scan hands the campaign's labels to
 * whoever runs the site.
 *
 * Only parameters whose single purpose is attribution are named, from a fixed list. Anything else
 * — `ref`, `id`, `page`, a token — may change what the page shows and is never touched. The rest of
 * the link is kept byte for byte: nothing is decoded and re-encoded, so a link that worked still
 * works. It is offered, never applied on its own: a campaign may be exactly what somebody wants to
 * measure.
 */

/** Parameters whose only job is to say where a click came from. */
const TRACKING = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'msclkid',
  'twclid',
  'ttclid',
  'igshid',
  'yclid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'li_fat_id',
  'srsltid',
]);

/** Whether one query parameter's name is a tracking one. `utm_` covers the whole family. */
export function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING.has(lower);
}

function nameOf(pair: string): string {
  const raw = pair.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // A malformed escape is not a tracking name the list knows; leave the pair alone.
    return raw;
  }
}

export interface WithoutTracking {
  /** The link with the tracking parameters taken out, everything else as it was. */
  url: string;
  /** The names taken out, in the order they appeared. */
  removed: string[];
}

/**
 * The link without its tracking parameters, or null when it has none.
 *
 * The query is the text between the first `?` and the first `#` after it. Pairs are split on `&`
 * and kept or dropped whole, so the ones that stay keep their exact bytes; a query left empty
 * loses its `?`, and the fragment is kept as it was.
 */
export function withoutTracking(url: string): WithoutTracking | null {
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);
  const question = beforeHash.indexOf('?');
  if (question === -1) return null;
  const base = beforeHash.slice(0, question);
  const pairs = beforeHash.slice(question + 1).split('&');
  const kept: string[] = [];
  const removed: string[] = [];
  for (const pair of pairs) {
    if (pair !== '' && isTracking(nameOf(pair))) removed.push(nameOf(pair));
    else kept.push(pair);
  }
  if (removed.length === 0) return null;
  const query = kept.filter((pair) => pair !== '').join('&');
  return { url: `${base}${query === '' ? '' : `?${query}`}${fragment}`, removed };
}
