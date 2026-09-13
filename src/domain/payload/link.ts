/**
 * The link payload. A link is the one payload kind of F0; the other kinds arrive in F2 and each
 * gets its own file beside this one.
 *
 * Only `http` and `https` are links (SPEC §5): a `javascript:` or `file:` URL is not a link a
 * phone should open, and a `mailto:` is the e-mail kind, not this one. The URL is normalised by
 * the WHATWG parser, so what the code carries is what a browser would resolve — including the
 * punycode form of an internationalised host. The "Opens …" line names the host as a person
 * reads it *and* as it will resolve when the two differ — `bücher.example (xn--bcher-kva.example)`
 * — so that a look-alike domain is visible before it is printed (SPEC §5).
 */

import { unicodeHost } from '../punycode';

export type LinkResult =
  | {
      ok: true;
      /** The normalised URL — the exact bytes the code carries. */
      url: string;
      /** The host as it will resolve, in ASCII (punycode for internationalised names). */
      host: string;
    }
  | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** The longest link the product accepts: comfortably below what a version-40 code carries. */
export const MAX_LINK_LENGTH = 2048;

export function parseLink(input: string): LinkResult {
  const text = input.trim();
  if (text.length === 0) {
    return { ok: false, reason: 'Type a link to see its code.' };
  }
  if (text.length > MAX_LINK_LENGTH) {
    return { ok: false, reason: `A link can be at most ${MAX_LINK_LENGTH} characters long.` };
  }
  if (/\s/.test(text)) {
    return { ok: false, reason: 'A link cannot contain spaces.' };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'That is not a link. It has to start with https:// or http://.' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'A link has to start with https:// or http://.' };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: 'A link needs a host, like example.com.' };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: 'A link with a user name or a password in it is not accepted.' };
  }
  return { ok: true, url: url.href, host: url.hostname };
}

/**
 * The one line that says what scanning does: "Opens example.com". Shared by the preview, the
 * figure's accessible name and the end-to-end suite, so that two readings of one fact agree.
 */
export function describeLink(url: string): string {
  try {
    return `Opens ${bothForms(new URL(url).hostname)}`;
  } catch {
    return 'Opens a link';
  }
}

/**
 * A host as a person reads it, with the form it resolves as beside it when they differ:
 * `example.com` stays `example.com`; `xn--bcher-kva.example` is said as
 * `bücher.example (xn--bcher-kva.example)`. Shared by the link and the e-mail summaries.
 */
export function bothForms(host: string): string {
  const forms = unicodeHost(host);
  return forms.differs ? `${forms.unicode} (${forms.punycode})` : host;
}
