/**
 * Punycode decoding (RFC 3492), so that an internationalised host can be shown in Unicode beside
 * the ASCII form a code carries. Decode only: the product never encodes a host itself — the
 * WHATWG URL parser does that on the way in — but it must be able to say what `xn--bcher-kva`
 * means before a look-alike domain is printed.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22; // '0'..'9' → 26..35
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // 'A'..'Z'
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // 'a'..'z'
  return -1;
}

/** One Punycode label (without its `xn--` prefix) as Unicode, or null when it is not one. */
export function decodePunycodeLabel(input: string): string | null {
  // A DNS label is at most 63 octets; anything longer is not a host label and is refused
  // before it can cost anything.
  if (input.length > 63) return null;
  const output: number[] = [];
  const last = input.lastIndexOf('-');
  let basicEnd = 0;
  if (last > 0) {
    for (let j = 0; j < last; j += 1) {
      const c = input.charCodeAt(j);
      if (c >= 0x80) return null;
      output.push(c);
    }
    basicEnd = last + 1;
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basicEnd; index < input.length;) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const d = digit(input.charCodeAt(index));
      index += 1;
      if (d < 0) return null;
      i += d * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
    }
    const outLength = output.length + 1;
    bias = adapt(i - oldi, outLength, oldi === 0);
    n += Math.floor(i / outLength);
    i %= outLength;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i += 1;
  }
  let text = '';
  for (const point of output) text += String.fromCodePoint(point);
  return text;
}

/** A host as it will resolve and as a person reads it, and whether the two differ. */
export function unicodeHost(host: string): { punycode: string; unicode: string; differs: boolean } {
  const unicode = host
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith('xn--')) return label;
      return decodePunycodeLabel(label.slice(4)) ?? label;
    })
    .join('.');
  return { punycode: host, unicode, differs: unicode !== host };
}
