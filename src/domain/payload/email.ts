/**
 * An e-mail, as a `mailto:` URI (RFC 6068).
 *
 * Two things here are security, not tidiness. The first is that the subject and the body are
 * percent-encoded as UTF-8 before they go into the query: a `?` or a `&` typed in a subject is
 * a character, not a new field, and a code that turns a subject into a `cc=` is a code that sends
 * mail somewhere the person never saw. The second is that the address gets the same treatment —
 * `ana?bcc=someone@example.com` is a legal-looking string and it is not two fields.
 *
 * The domain is shown as it will resolve, in ASCII. An internationalised name becomes punycode
 * here, in the summary, before the code is printed, so a look-alike domain is visible while it
 * still costs nothing to notice (SPEC §5).
 */

import { bothForms } from './link';
import type { PayloadResult } from './index';

export interface EmailForm {
  kind: 'email';
  to: string;
  subject: string;
  body: string;
}

/**
 * The delimiters RFC 6068 lets an address carry unencoded — minus the comma and the semicolon.
 * The RFC allows them, but `to` is a comma-separated list of addresses, and a mail client that
 * sees `ana,evil@example.com` opens a message to two people. Everything outside this set and the
 * unreserved set is percent-encoded, `?` and `&` and `#` and `,` and `;` included.
 */
const ADDRESS_SAFE_DELIMITERS = new Set(['!', '$', "'", '(', ')', '*', '+', ':']);

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Percent-encoding triples a byte at worst; these keep a full message inside version 40. */
export const MAX_SUBJECT_BYTES = 200;
export const MAX_BODY_BYTES = 800;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Characters that would make `http://<domain>` parse as something other than a host. */
const DOMAIN_FORBIDDEN = /[/\\?#:@[\]]/;

function encodeAddressPart(part: string): string {
  let out = '';
  for (const character of part) {
    out +=
      UNRESERVED.test(character) || ADDRESS_SAFE_DELIMITERS.has(character)
        ? character
        : encodeURIComponent(character);
  }
  return out;
}

interface Address {
  /** The local part as typed — what the summary shows. */
  local: string;
  /** The host as it will resolve, in ASCII. */
  host: string;
}

type AddressResult = { ok: true; address: Address } | { ok: false; reason: string };

/** Read one address, `local@domain`, and resolve its domain the way a browser would. */
export function parseAddress(input: string): AddressResult {
  const text = input.trim();
  if (text.length === 0) {
    return { ok: false, reason: 'Type an e-mail address to see its code.' };
  }
  if (/\s/.test(text)) {
    return { ok: false, reason: 'An e-mail address cannot contain spaces.' };
  }
  const parts = text.split('@');
  if (parts.length === 1) {
    return { ok: false, reason: 'An e-mail address needs an @, like ana@example.com.' };
  }
  if (parts.length > 2) {
    return { ok: false, reason: 'An e-mail address can have only one @.' };
  }
  const [local = '', domain = ''] = parts;
  if (local.length === 0) {
    return { ok: false, reason: 'An e-mail address needs a name before the @.' };
  }
  if (domain.length === 0) {
    return {
      ok: false,
      reason: 'An e-mail address needs a domain after the @, like example.com.',
    };
  }
  if (DOMAIN_FORBIDDEN.test(domain)) {
    return { ok: false, reason: 'That is not an e-mail domain. Write it like example.com.' };
  }
  let host: string;
  try {
    host = new URL(`http://${domain}`).hostname;
  } catch {
    return { ok: false, reason: 'That is not an e-mail domain. Write it like example.com.' };
  }
  if (host.length === 0) {
    return { ok: false, reason: 'That is not an e-mail domain. Write it like example.com.' };
  }
  return { ok: true, address: { local, host } };
}

export function buildEmail(form: EmailForm): PayloadResult {
  const parsed = parseAddress(form.to);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, field: 'to' };
  }
  const { local, host } = parsed.address;

  const subjectBytes = byteLength(form.subject);
  if (subjectBytes > MAX_SUBJECT_BYTES) {
    return {
      ok: false,
      reason: `A subject can be at most ${MAX_SUBJECT_BYTES} bytes long, and this is ${subjectBytes}.`,
      field: 'subject',
    };
  }
  const bodyBytes = byteLength(form.body);
  if (bodyBytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      reason: `A body can be at most ${MAX_BODY_BYTES} bytes long, and this is ${bodyBytes}.`,
      field: 'body',
    };
  }

  const query: string[] = [];
  if (form.subject.length > 0) query.push(`subject=${encodeURIComponent(form.subject)}`);
  if (form.body.length > 0) query.push(`body=${encodeURIComponent(form.body)}`);

  const address = `${encodeAddressPart(local)}@${host}`;
  const payload = query.length > 0 ? `mailto:${address}?${query.join('&')}` : `mailto:${address}`;

  return { ok: true, payload, summary: `Writes to ${local}@${bothForms(host)}` };
}
