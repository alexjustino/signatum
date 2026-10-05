/**
 * The look-alike guard (SPEC §10, P3): a link is printed once and read by people who cannot see
 * where it goes, so the address inside it is said plainly before it is printed — and when a code
 * is read, before anybody follows it.
 *
 * Four things are named, each in one sentence: a label that mixes alphabets, a label written in
 * another alphabet that imitates a Latin word, a known link shortener, and an IP address instead
 * of a name (with a further word when that address is on a private network). None of them is a
 * refusal: a shortener can be somebody's own, an address can be on purpose. The guard says what
 * the address is; the person decides (ADR-034).
 *
 * Pure. The host's own form is the input — the punycode a URL parser produces — and the Unicode
 * form comes from the same RFC 3492 decoder the summaries use.
 */

import { decodePunycodeLabel } from './punycode';

export type HostWarningKind = 'mixed-script' | 'imitation' | 'symbol' | 'shortener' | 'ip-address';

export interface HostWarning {
  kind: HostWarningKind;
  /** One sentence, ready to show. */
  sentence: string;
}

/**
 * The scripts a letter can belong to, checked in this order. Digits, hyphens and the marks that
 * belong to every script are not letters of any one of them and are ignored.
 */
const SCRIPTS: ReadonlyArray<[string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Cherokee', /\p{Script=Cherokee}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Bopomofo', /\p{Script=Bopomofo}/u],
];

/**
 * The mixtures a real name uses, from Unicode's "highly restrictive" profile (UTS #39 §5.2):
 * Japanese writes Han, Hiragana and Katakana together, Chinese pairs Han with Bopomofo, Korean
 * Han with Hangul — each with Latin beside it. Anything else in one label is a mixture worth
 * saying out loud.
 */
const ALLOWED_MIXTURES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Bopomofo']),
  new Set(['Latin', 'Han', 'Hangul']),
];

/**
 * Letters that look like a Latin letter in the fonts phones use, by the letter they imitate. Not
 * Unicode's whole confusables table — the lower-case letters that are actually used to imitate
 * domains, which is what a person typing or reading a link meets.
 */
const IMITATES: Readonly<Record<string, string>> = {
  // Latin: a letter of the Latin script itself that is not the ASCII one it imitates
  ɡ: 'g',
  // Cyrillic
  а: 'a',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  һ: 'h',
  і: 'i',
  ј: 'j',
  ӏ: 'l',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  ѕ: 's',
  ԝ: 'w',
  х: 'x',
  у: 'y',

  // Greek
  α: 'a',
  ϲ: 'c',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  // Armenian
  օ: 'o',
  ս: 'u',
  հ: 'h',
  ո: 'n',
  զ: 'q',
  ց: 'g',
};

/**
 * Where a whole label in one of these alphabets is at home: the country-code domains of the
 * countries that write it, and the domains written in it. A Greek word under `.gr` is a Greek word;
 * the same letters under `.com` spelling a Latin word are what a look-alike is made of. This is
 * the rule browsers apply to whole-script confusables, and it keeps real words from being
 * reported as tricks.
 */
const HOME_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  // Country codes of countries that write Cyrillic, and the Cyrillic domains. Not `.me`, `.rs`
  // or `.mk` and the like: those are sold to everybody, and a home exemption there is an
  // exemption for anybody.
  Cyrillic: [
    'ru',
    'su',
    'by',
    'ua',
    'kz',
    'bg',
    'uz',
    'рф',
    'бг',
    'срб',
    'укр',
    'қаз',
    'мон',
    'бел',
    'мкд',
    'рус',
  ],
  Greek: ['gr', 'ελ'],
  // `.am` is sold worldwide as a word, so only the Armenian-script domain is home.
  Armenian: ['հայ'],
};

/** Services whose links are redirects somebody else controls. Matched as the host or its parent. */
export const SHORTENERS: readonly string[] = [
  'bit.ly',
  'bl.ink',
  'buff.ly',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'lnkd.in',
  'ow.ly',
  'qrco.de',
  'rb.gy',
  'rebrand.ly',
  's.id',
  'shorturl.at',
  't.co',
  't.ly',
  'tiny.cc',
  'tinyurl.com',
  'v.gd',
];

function scriptOf(letter: string): string | null {
  for (const [name, pattern] of SCRIPTS) {
    if (pattern.test(letter)) return name;
  }
  return null;
}

function scriptsIn(label: string): Set<string> {
  const found = new Set<string>();
  for (const letter of label) {
    if (!/\p{L}/u.test(letter)) continue;
    const script = scriptOf(letter);
    if (script !== null) found.add(script);
  }
  return found;
}

/**
 * Kana that look like a slash or a dash. In a Japanese name they are letters; standing alone among
 * Latin letters they are a separator that is not one — `bank.comノlogin` — and are treated as the
 * symbol they are being used as.
 */
const KANA_SEPARATORS = new Set(['ノ', 'ソ', 'ン', 'ー', 'ヽ', 'ゝ', 'ヾ', 'ゞ']);

/**
 * The characters of a label that are not a letter, a digit or a hyphen — or that are kana used
 * as separators. A host name needs none of them, and every one of them can be drawn to look like
 * punctuation that is not there.
 */
function symbolsIn(label: string): string[] {
  const letters = [...label];
  const otherKana = letters.some(
    (c) =>
      !KANA_SEPARATORS.has(c) && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(c),
  );
  const found: string[] = [];
  for (const c of letters) {
    const symbol = !/[\p{L}\p{N}-]/u.test(c) || (KANA_SEPARATORS.has(c) && !otherKana);
    if (symbol && !found.includes(c)) found.push(c);
  }
  return found;
}

/** A code point the way a reader can look it up: `U+2044`. */
function codePoint(c: string): string {
  return `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The label as it goes into a sentence: anything that is not a letter, a digit or a hyphen is
 * written as its code point, so a label cannot add words, quotes or spaces to the sentence it is
 * quoted in.
 */
function shown(label: string): string {
  let out = '';
  for (const c of label) out += /[\p{L}\p{N}-]/u.test(c) ? c : `[${codePoint(c)}]`;
  return out;
}

function allowedMixture(scripts: Set<string>): boolean {
  if (scripts.size <= 1) return true;
  return ALLOWED_MIXTURES.some((allowed) => [...scripts].every((s) => allowed.has(s)));
}

/** The label with every imitating letter replaced by the Latin one it imitates. */
function skeleton(label: string): string {
  let out = '';
  for (const letter of label.toLowerCase()) out += IMITATES[letter] ?? letter;
  return out;
}

function listOf(scripts: Set<string>): string {
  // In the table's order, so a sentence always reads "Latin and Cyrillic", whichever came first.
  const order = SCRIPTS.map(([name]) => name);
  const names = [...scripts].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** An IPv4 address in dotted form, as a URL parser normalises it. */
function ipv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function privateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && (b ?? 0) >= 64 && (b ?? 0) <= 127) ||
    a === 127 ||
    (a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function privateIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  // An IPv4 address carried in IPv6, `::ffff:c0a8:1`, is as private as the IPv4 one it carries.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (mapped !== null) {
    const high = parseInt(mapped[1] ?? '0', 16);
    const low = parseInt(mapped[2] ?? '0', 16);
    return privateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return bare === '::1' || /^f[cd]/.test(bare) || /^fe[89ab]/.test(bare);
}

/**
 * What a host is, in sentences: nothing for an ordinary name.
 *
 * @param host The host as a URL parser gives it — lower case, punycode for an internationalised
 *   name, an IPv6 address in brackets.
 */
export function checkHost(host: string): HostWarning[] {
  const warnings: HostWarning[] = [];
  const name = host.toLowerCase().replace(/\.$/, '');

  const v4 = ipv4(name);
  const v6 = name.startsWith('[') && name.endsWith(']');
  if (v4 !== null || v6) {
    const isPrivate = v4 !== null ? privateIpv4(v4) : privateIpv6(name);
    warnings.push({
      kind: 'ip-address',
      sentence: isPrivate
        ? `${name} is an address on a private network, not a name: it opens only on that network, and not from a phone outside it.`
        : `${name} is a raw IP address rather than a name, so nobody reading it can tell whose server it is.`,
    });
    return warnings;
  }

  const shortener = SHORTENERS.find((s) => name === s || name.endsWith(`.${s}`));
  if (shortener !== undefined) {
    warnings.push({
      kind: 'shortener',
      sentence: `${shortener} is a link shortener: the code opens a redirect, and where it lands is decided by whoever controls that short link, not by this code.`,
    });
  }

  const labels = name
    .split('.')
    .map((raw) => (raw.startsWith('xn--') ? (decodePunycodeLabel(raw.slice(4)) ?? raw) : raw));
  const topLevel = labels.at(-1) ?? '';
  for (const label of labels) {
    const symbols = symbolsIn(label);
    if (symbols.length > 0) {
      warnings.push({
        kind: 'symbol',
        sentence: `“${shown(label)}” contains ${symbols.map(codePoint).join(', ')}, which ${symbols.length === 1 ? 'is' : 'are'} not a letter, a digit or a hyphen: a name with ${symbols.length === 1 ? 'it' : 'them'} in can be drawn to look like a different address.`,
      });
    }
    const scripts = scriptsIn(label);
    const imitated = skeleton(label);
    const imitatesLatin = imitated !== label && /^[a-z0-9-]+$/.test(imitated);
    if (!allowedMixture(scripts)) {
      warnings.push({
        kind: 'mixed-script',
        sentence: imitatesLatin
          ? `“${shown(label)}” mixes ${listOf(scripts)} letters: it reads as “${imitated}”, but it is a different address.`
          : `“${shown(label)}” mixes ${listOf(scripts)} letters in one name, which real names rarely do.`,
      });
    } else if (
      imitatesLatin &&
      ![...scripts].some((script) => HOME_DOMAINS[script]?.includes(topLevel))
    ) {
      warnings.push({
        kind: 'imitation',
        sentence:
          scripts.size === 1 && scripts.has('Latin')
            ? `“${shown(label)}” uses a letter that only looks like a plain Latin one: it reads as “${imitated}”, but it is a different address.`
            : `“${shown(label)}” is written in ${listOf(scripts)} letters that look like the Latin “${imitated}”: it is a different address from the one it resembles.`,
      });
    }
  }
  return warnings;
}

/** The warnings for a link, or none when it is not a link a URL parser accepts. */
export function checkLink(url: string): HostWarning[] {
  try {
    return checkHost(new URL(url).hostname);
  } catch {
    return [];
  }
}
