/**
 * Plain text. The one kind with no format to escape to: what is typed is what the code carries,
 * byte for byte, including the line breaks and the emoji.
 *
 * That is the whole point of it, so nothing here trims, collapses or normalises — a trailing
 * space in a serial number is part of the serial number. The only two answers are "yes" and a
 * sentence: text that is empty is not a code, and text that no code can hold is not a code
 * either. The limit is the largest byte-mode payload a version-40 symbol carries at error
 * correction L (2 953 bytes); anything a logo or a higher level costs is taken off later, by the
 * encoder, which is the only part that knows.
 */

import type { PayloadResult } from './index';

export interface TextForm {
  kind: 'text';
  text: string;
}

/** The most a version-40 symbol carries in byte mode at level L. */
export const MAX_TEXT_BYTES = 2953;

/** How many bytes the text is once encoded as UTF-8 — what a QR symbol actually counts. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function buildText(form: TextForm): PayloadResult {
  const text = form.text;
  if (text.trim().length === 0) {
    return { ok: false, reason: 'Type the text to see its code.', field: 'text' };
  }
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_TEXT_BYTES) {
    return {
      ok: false,
      reason: `Text can be at most ${MAX_TEXT_BYTES} bytes long, and this is ${bytes}.`,
      field: 'text',
    };
  }
  return { ok: true, payload: text, summary: 'Shows the text' };
}
