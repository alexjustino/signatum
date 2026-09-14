/**
 * A phone number, as a `tel:` URI (RFC 3966).
 *
 * People write numbers with brackets, dots, dashes and spaces, and a phone dials none of them.
 * So the payload is the digits with at most one leading `+`, and the sentence on screen is the
 * number as it was typed — the person checks what they wrote, the code carries what dials.
 *
 * The `+` leads or it does not exist: a `+` in the middle is not a separator a dialler ignores,
 * it is a number typed wrong, and E.164 has room for 15 digits, no more. Everything else is
 * refused with a sentence rather than silently stripped, because a number quietly turned into a
 * different number is the one failure a person cannot see on a printed code.
 */

import type { PayloadResult } from './index';

/** The shortest useful number: a three-digit short code. */
export const MIN_PHONE_DIGITS = 3;
/** E.164's ceiling, country code included. */
export const MAX_PHONE_DIGITS = 15;

/** The separators a person writes and a dialler ignores. */
const VISUAL_SEPARATORS = /[\s.\-()]/g;

export interface PhoneForm {
  kind: 'phone';
  number: string;
}

export interface DialledNumber {
  /** The bytes the code carries: digits, with at most one leading `+`. */
  dialled: string;
  /** The number as typed, trimmed — what the sentence shows. */
  display: string;
}

export type PhoneNumberResult = { ok: true; number: DialledNumber } | { ok: false; reason: string };

/** The characters a number may be written with: digits, a plus and the visual separators. */
const ALLOWED_CHARACTERS = /^[0-9+\s.\-()]+$/;

/** Read a number the way it was written and reduce it to what a phone dials. */
export function parsePhoneNumber(input: string): PhoneNumberResult {
  const display = input.trim();
  if (display.length === 0) {
    return { ok: false, reason: 'Type a phone number to see its code.' };
  }
  if (!ALLOWED_CHARACTERS.test(display)) {
    return {
      ok: false,
      reason:
        'A phone number can have only digits, a leading + and the separators ( ) - . and space.',
    };
  }
  const compact = display.replace(VISUAL_SEPARATORS, '');
  const international = compact.startsWith('+');
  const digits = international ? compact.slice(1) : compact;
  if (digits.includes('+')) {
    return { ok: false, reason: 'A phone number can have a + only at the start.' };
  }
  if (digits.length < MIN_PHONE_DIGITS) {
    return { ok: false, reason: `A phone number needs at least ${MIN_PHONE_DIGITS} digits.` };
  }
  if (digits.length > MAX_PHONE_DIGITS) {
    return { ok: false, reason: `A phone number can have at most ${MAX_PHONE_DIGITS} digits.` };
  }
  return { ok: true, number: { dialled: `${international ? '+' : ''}${digits}`, display } };
}

export function buildPhone(form: PhoneForm): PayloadResult {
  const parsed = parsePhoneNumber(form.number);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, field: 'number' };
  }
  return {
    ok: true,
    payload: `tel:${parsed.number.dialled}`,
    summary: `Calls ${parsed.number.display}`,
  };
}
