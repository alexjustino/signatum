/**
 * A print against the library (SPEC §10, P6): a code found by Read is matched against the saved
 * codes by what it carries — never by how it looks, by its name or by a stamp.
 *
 * A saved code is its fields, so what it carries is what the builders make of them: the same
 * `buildPayload` Create runs and Open runs again, and nothing restated here. The comparison is
 * byte for byte. A link with a trailing slash, the same words in another Unicode normalisation or
 * a password one letter apart is a different code, and a camera would say so; a match that
 * forgave any of them would be naming a saved code the print is not.
 */

import { buildPayload, type PayloadForm } from './payload';

/**
 * The string a saved code makes, or null when it cannot make one as it is stored — a Wi-Fi saved
 * without its password (ADR-018) carries nothing until somebody types the password again, so it
 * matches nothing rather than matching every network of that name.
 */
export function payloadOfSaved(form: PayloadForm): string | null {
  const built = buildPayload(form);
  return built.ok ? built.payload : null;
}

/**
 * Strict UTF-8, and a leading byte-order mark kept as a character: the default decoder would
 * swallow it, and a code that starts with three extra bytes is not the code that does not.
 */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * What a read code carries, as the string it would have to equal — or null when the bytes are not
 * UTF-8, which no payload this product builds can be (the encoder writes UTF-8 and nothing else).
 *
 * Comparing strings is comparing bytes here, and not by accident: strict UTF-8 maps byte sequences
 * to well-formed strings one to one, so two strings decoded from bytes are equal exactly when the
 * bytes are. A saved payload that is not well-formed (a lone surrogate) cannot equal one, and it
 * could never have been encoded either.
 */
function carried(text: string | Uint8Array): string | null {
  if (typeof text === 'string') return text;
  try {
    return UTF8.decode(text);
  } catch {
    return null;
  }
}

/**
 * The saved codes whose payload is exactly what the read code carries, in the order the list
 * gave them. `text` is the read code's bytes — or a string, when the caller already holds one.
 * Empty when nothing matches, when the bytes are not text, or when nothing was given to match.
 */
export function matchSaved<T extends { form: PayloadForm }>(
  text: string | Uint8Array,
  saved: readonly T[],
): T[] {
  const wanted = carried(text);
  if (wanted === null || wanted.length === 0) return [];
  return saved.filter((each) => payloadOfSaved(each.form) === wanted);
}

/**
 * The title of the bar a matched code shows: the saved code's name when there is one, the count
 * when there are more — their names are listed under it, each with its own Open.
 */
export function describeMatch(names: readonly string[]): string {
  if (names.length === 1) return `Matches your saved code ${names[0] ?? ''}`;
  return `Matches ${names.length} of your saved codes`;
}
