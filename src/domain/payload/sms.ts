/**
 * A text message, as `SMSTO:<number>:<message>`.
 *
 * Not `sms:` — the `sms:` URI exists (RFC 5724) and the two mobile platforms disagree about
 * where the body goes, so a code that works on one opens an empty message on the other. `SMSTO:`
 * is the form both cameras have read for a decade; it is a de-facto format, and the product uses
 * the one that works on the phone rather than the one that reads best in a specification.
 *
 * There is exactly one delimiter, and it is the `:` after the number — which is why the number is
 * validated as a phone number first: digits and one leading `+` cannot contain a `:`, so the
 * message needs no escaping at all and keeps its line breaks, its colons and its emoji as typed.
 */

import { parsePhoneNumber } from './phone';

import type { PayloadResult } from './index';

export interface SmsForm {
  kind: 'sms';
  number: string;
  message: string;
}

/** Longer than any phone's message, and still inside version 40 with the number in front. */
export const MAX_MESSAGE_BYTES = 2000;

export function buildSms(form: SmsForm): PayloadResult {
  const parsed = parsePhoneNumber(form.number);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, field: 'number' };
  }
  if (form.message.trim().length === 0) {
    return { ok: false, reason: 'Type the message the text will carry.', field: 'message' };
  }
  const bytes = new TextEncoder().encode(form.message).length;
  if (bytes > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      reason: `A message can be at most ${MAX_MESSAGE_BYTES} bytes long, and this is ${bytes}.`,
      field: 'message',
    };
  }
  return {
    ok: true,
    payload: `SMSTO:${parsed.number.dialled}:${form.message}`,
    summary: `Texts ${parsed.number.display}`,
  };
}
