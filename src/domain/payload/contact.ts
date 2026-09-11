/**
 * A person, as a phone stores one: vCard 3.0, vCard 4.0 or MECARD.
 *
 * Three formats carry the same thirteen fields, and the choice between them is a choice about
 * density, not about taste. A full vCard is several hundred bytes, and bytes are modules: the
 * same card that scans from an A4 page can be unreadable on a business card. MECARD says the
 * same things in roughly half the space, and pays for it with a field it does not have — there
 * is nowhere to put a job title — so the builder says so on the accepted result (`note`) rather
 * than dropping it quietly.
 *
 * Escaping is the reason this file is long. In a vCard, `;` separates the components of a
 * structured value and `,` separates the values of a multi-valued one, so a family name written
 * `O'Brien; Jr` is not a badly punctuated name, it is a name and a suffix — a different person
 * in the address book. Every text value is escaped by RFC 6350 §3.4 (RFC 2426 §2.4.2 in 3.0):
 * the backslash first, then `;` and `,`, and a line break becomes the two characters `\n`. The
 * components of N and ADR are escaped one by one and only then joined. MECARD is the WIFI rule,
 * plus the colon that separates its keys from its values.
 *
 * Long lines are folded at 75 octets with CRLF and a space, on UTF-8 octets and never inside a
 * multi-byte sequence (RFC 6350 §3.2) — a card folded through the middle of an `ü` imports as
 * mojibake. UTF-8 is the charset in both versions, so no CHARSET parameter is written.
 *
 * The telephone, e-mail and web fields are not validated again here: they are handed to the
 * parsers the phone, e-mail and link kinds already have tests for, so that a number refused on
 * the Phone tab is refused on this one for the same reason and in the same words.
 *
 * Two decisions a later reader might be tempted to "fix": a newline inside a MECARD value passes
 * through unchanged, because MECARD has no escape for it and writing `\n` would be read back as
 * the letter n; and the URL property of a vCard is written raw, because RFC 6350 types it as a
 * URI and a URI is not backslash-escaped — a `;` or `,` inside a path is legal there, and
 * `parseLink` has already refused anything with whitespace in it.
 */

import { MAX_PAYLOAD_BYTES } from '../qr/encode';

import { parseAddress } from './email';
import { parseLink } from './link';
import { parsePhoneNumber } from './phone';
import { utf8ByteLength } from './text';

import type { PayloadResult } from './index';

/** The formats, in the order they are offered: the most widely imported one first. */
export const CONTACT_FORMATS = ['vcard3', 'vcard4', 'mecard'] as const;

export type ContactFormat = (typeof CONTACT_FORMATS)[number];

/** What each format is called on screen. */
export const CONTACT_FORMAT_LABELS: Record<ContactFormat, string> = {
  vcard3: 'vCard 3.0',
  vcard4: 'vCard 4.0',
  mecard: 'MECARD',
};

export interface ContactForm {
  kind: 'contact';
  format: ContactFormat;
  givenName: string;
  familyName: string;
  organisation: string;
  title: string;
  phone: string;
  mobile: string;
  email: string;
  url: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  note: string;
}

/** RFC 6350 §3.2: a physical line is at most 75 octets, the continuation's space included. */
export const MAX_LINE_OCTETS = 75;

/** What MECARD cannot carry, said once, in the words the screen shows. */
export const MECARD_TITLE_NOTE = 'MECARD has no field for a title; it was left out.';

const ENCODER = new TextEncoder();

/**
 * A text value, escaped for a vCard: the backslash first, so that escaping is not itself
 * escapable, then the two separators, then the line break as the two characters `\n`.
 */
export function escapeVCardText(value: string): string {
  return value.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r\n|[\r\n]/g, '\\n');
}

/** A MECARD value: the WIFI rule (`\`, `;`, `,`) plus the `:` that separates key from value. */
export function escapeMecardValue(value: string): string {
  return value.replace(/[\\;,:]/g, (character) => `\\${character}`);
}

/**
 * Fold one logical line into physical lines of at most 75 octets, joined by CRLF and a space.
 *
 * The walk is by code point, so a fold never lands inside a UTF-8 sequence; the continuation's
 * leading space counts towards the 75, which is what makes a folded line a 75-octet line and
 * not a 76-octet one. Unfolding — remove every CRLF that is followed by a space — gives back
 * exactly what came in.
 */
export function foldLine(line: string): string {
  if (ENCODER.encode(line).length <= MAX_LINE_OCTETS) return line;
  const segments: string[] = [];
  let segment = '';
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const character of line) {
    const size = ENCODER.encode(character).length;
    if (octets + size > limit) {
      segments.push(segment);
      segment = '';
      octets = 0;
      // Every line after the first spends one of its 75 octets on the continuation space.
      limit = MAX_LINE_OCTETS - 1;
    }
    segment += character;
    octets += size;
  }
  segments.push(segment);
  return segments.join('\r\n ');
}

/** The parts of a card, validated and normalised — what each format then spells out. */
interface Card {
  given: string;
  family: string;
  full: string;
  organisation: string;
  title: string;
  /** The dialled forms: digits, with a leading `+` when one was typed. */
  work: string;
  cell: string;
  /** The address as it will resolve, its domain in ASCII. */
  email: string;
  /** The normalised URL, exactly as the link kind emits it. */
  url: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  note: string;
}

/** The street parts, in the order both formats list them. */
function addressParts(card: Card): readonly string[] {
  return [card.street, card.city, card.region, card.postcode, card.country];
}

function hasAddress(card: Card): boolean {
  return addressParts(card).some((part) => part.length > 0);
}

function buildVCard(card: Card, version: '3.0' | '4.0'): string {
  const four = version === '4.0';
  const lines: string[] = ['BEGIN:VCARD', `VERSION:${version}`];
  // RFC 6350 §6.1.4: what the card is about. 3.0 has no KIND property.
  if (four) lines.push('KIND:individual');

  const escape = escapeVCardText;
  const components = (parts: readonly string[]): string => parts.map(escape).join(';');

  // Five components: family, given, additional, prefixes, suffixes. The empty ones stay, because
  // in a structured value position is meaning and a missing `;` shifts every field after it.
  lines.push(`N:${components([card.family, card.given, '', '', ''])}`);
  lines.push(`FN:${escape(card.full)}`);
  if (card.organisation.length > 0) lines.push(`ORG:${escape(card.organisation)}`);
  if (card.title.length > 0) lines.push(`TITLE:${escape(card.title)}`);
  if (card.work.length > 0) {
    lines.push(
      four ? `TEL;TYPE=work,voice;VALUE=uri:tel:${card.work}` : `TEL;TYPE=WORK,VOICE:${card.work}`,
    );
  }
  if (card.cell.length > 0) {
    lines.push(four ? `TEL;TYPE=cell;VALUE=uri:tel:${card.cell}` : `TEL;TYPE=CELL:${card.cell}`);
  }
  if (card.email.length > 0) {
    // 4.0 dropped 3.0's TYPE=INTERNET: there is no other kind of e-mail address left.
    lines.push(four ? `EMAIL:${escape(card.email)}` : `EMAIL;TYPE=INTERNET:${escape(card.email)}`);
  }
  // URL is a URI, not text (RFC 6350 §6.7.8), and a URI value is not backslash-escaped. It comes
  // from the link parser, which has already refused anything with whitespace in it.
  if (card.url.length > 0) lines.push(`URL:${card.url}`);
  if (hasAddress(card)) {
    // Seven components: post office box, extended address, street, locality, region, postal
    // code, country. The first two are deliberately empty — RFC 6350 §6.3.1 deprecates both.
    const adr = components(['', '', ...addressParts(card)]);
    lines.push(four ? `ADR;TYPE=work:${adr}` : `ADR;TYPE=WORK:${adr}`);
  }
  if (card.note.length > 0) lines.push(`NOTE:${escape(card.note)}`);
  lines.push('END:VCARD');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * Join MECARD's positional components, dropping the empty ones at the end.
 *
 * Position is meaning here too — the first component of `N:` is the family name — so an empty
 * component in the middle keeps its comma. A trailing one has no position to hold, and where
 * `N:Souza,` is a card with a stray separator in it, `N:Souza` is a person with one name.
 */
function mecardComponents(parts: readonly string[]): string {
  const kept = [...parts];
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.map(escapeMecardValue).join(',');
}

function buildMecard(card: Card): string {
  const fields: string[] = [`N:${mecardComponents([card.family, card.given])}`];
  const add = (key: string, value: string): void => {
    if (value.length > 0) fields.push(`${key}:${escapeMecardValue(value)}`);
  };
  add('ORG', card.organisation);
  add('TEL', card.work);
  add('TEL', card.cell);
  add('EMAIL', card.email);
  add('URL', card.url);
  if (hasAddress(card)) fields.push(`ADR:${mecardComponents(addressParts(card))}`);
  add('NOTE', card.note);
  return `MECARD:${fields.map((field) => `${field};`).join('')};`;
}

/** A number the way the phone kind reads it, or the reason it is not one. An empty field is not. */
function readNumber(input: string): { ok: true; dialled: string } | { ok: false; reason: string } {
  if (input.trim().length === 0) return { ok: true, dialled: '' };
  const parsed = parsePhoneNumber(input);
  if (!parsed.ok) return parsed;
  // A card travels: a number without its country code is a local number on whatever phone
  // reads it (RFC 3966 would want a phone-context), so a card insists on the plus.
  if (!parsed.number.dialled.startsWith('+')) {
    return { ok: false, reason: 'A contact number needs its country code, starting with +.' };
  }
  return { ok: true, dialled: parsed.number.dialled };
}

export function buildContact(form: ContactForm): PayloadResult {
  // The type says `format` is one of three words; the bytes must not trust the type, because a
  // tampered <select> can hand the form anything and the format decides every byte below.
  if (!CONTACT_FORMATS.includes(form.format)) {
    return { ok: false, reason: 'Choose the format the card is written in.', field: 'format' };
  }

  const given = form.givenName.trim();
  const family = form.familyName.trim();
  if (given.length === 0 && family.length === 0) {
    return { ok: false, reason: 'A contact needs at least a name.', field: 'givenName' };
  }

  const work = readNumber(form.phone);
  if (!work.ok) return { ok: false, reason: work.reason, field: 'phone' };
  const cell = readNumber(form.mobile);
  if (!cell.ok) return { ok: false, reason: cell.reason, field: 'mobile' };

  let email = '';
  if (form.email.trim().length > 0) {
    const parsed = parseAddress(form.email);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, field: 'email' };
    email = `${parsed.address.local}@${parsed.address.host}`;
  }

  let url = '';
  if (form.url.trim().length > 0) {
    const link = parseLink(form.url);
    if (!link.ok) return { ok: false, reason: link.reason, field: 'url' };
    url = link.url;
  }

  const card: Card = {
    given,
    family,
    full: [given, family].filter((part) => part.length > 0).join(' '),
    organisation: form.organisation.trim(),
    title: form.title.trim(),
    work: work.dialled,
    cell: cell.dialled,
    email,
    url,
    street: form.street.trim(),
    city: form.city.trim(),
    region: form.region.trim(),
    postcode: form.postcode.trim(),
    country: form.country.trim(),
    note: form.note.trim(),
  };

  const payload =
    form.format === 'mecard'
      ? buildMecard(card)
      : buildVCard(card, form.format === 'vcard4' ? '4.0' : '3.0');

  const bytes = utf8ByteLength(payload);
  if (bytes > MAX_PAYLOAD_BYTES) {
    // The two ways out, in the order they cost: a denser format, or less to say. Suggesting
    // MECARD to somebody already writing one would be advice they have taken.
    const advice = form.format === 'mecard' ? 'Use fewer fields.' : 'Use MECARD, or fewer fields.';
    return {
      ok: false,
      reason: `A contact card can be at most ${MAX_PAYLOAD_BYTES} bytes long, and this is ${bytes}. ${advice}`,
    };
  }

  const summary = `Adds ${card.full} to contacts`;
  return form.format === 'mecard' && card.title.length > 0
    ? { ok: true, payload, summary, note: MECARD_TITLE_NOTE }
    : { ok: true, payload, summary };
}
