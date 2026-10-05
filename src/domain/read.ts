/**
 * Reading a code somebody else made (SPEC §2.9): what the bytes mean, said in the product's own
 * words, and whether a code of that many modules would scan at a printed width. The decoding of
 * the pixels is the host's; the meaning of the bytes and the arithmetic of size are the
 * domain's, so that a read code and a made code are described by the same sentences.
 */

import { MIN_MODULE_MM, moduleSizeMm } from './density';
import { describeLink } from './payload/link';
import { checkHost, checkLink } from './lookalike';
import { unicodeHost } from './punycode';

export type ReadKind =
  'link' | 'text' | 'email' | 'phone' | 'sms' | 'wifi' | 'geo' | 'contact' | 'other';

export interface ReadDescription {
  kind: ReadKind;
  /** One line: what scanning does. */
  summary: string;
  /** Lines worth showing under the summary: fields, the two forms of a host, a note. */
  details: string[];
  /** The content as text, or a hex dump when it is not text. */
  content: string;
  /** True when the content holds a secret worth masking on screen. */
  sensitive: boolean;
  /**
   * What the address inside the code is, when it is worth saying before anybody follows it: a
   * look-alike, a shortener, a raw IP (ADR-034). Empty for everything else.
   */
  warnings: string[];
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hexDump(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** `KEY:value;` fields with backslash escapes — the grammar WIFI and MECARD share. */
function escapedFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = '';
  let value = '';
  let inValue = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i] ?? '';
    if (!inValue) {
      if (c === ':') inValue = true;
      else if (c === ';') key = '';
      else key += c;
      continue;
    }
    if (c === '\\' && i + 1 < body.length) {
      value += body[i + 1] ?? '';
      i += 1;
    } else if (c === ';') {
      // Readers treat the key as case-insensitive (`p:` opens a network as `P:` does), so it
      // is normalised here once; a password under a lowercase key is still a password.
      out[key.toUpperCase()] = value;
      key = '';
      value = '';
      inValue = false;
    } else value += c;
  }
  return out;
}

function vcardField(text: string, name: string): string | null {
  const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(text);
  return (
    m?.[1]
      ?.replace(/\\([;,\\])/g, '$1')
      .replace(/\\n/gi, ' ')
      .trim() ?? null
  );
}

/** What the bytes of a read code mean, in the same sentences the Create screen uses. */
export function describeBytes(bytes: Uint8Array): ReadDescription {
  const described = describeContent(bytes);
  return { ...described, warnings: warningsFor(described) };
}

/** The look-alike guard over the address a link or an e-mail code carries. */
function warningsFor({ kind, content }: Omit<ReadDescription, 'warnings'>): string[] {
  if (kind === 'link') return checkLink(content).map((w) => w.sentence);
  if (kind === 'email') {
    const sentences = new Set<string>();
    for (const address of recipients(content)) {
      const at = address.lastIndexOf('@');
      const domain = address.slice(at + 1);
      if (at < 0 || domain.length === 0) continue;
      try {
        for (const w of checkHost(new URL(`http://${domain}`).hostname)) sentences.add(w.sentence);
      } catch {
        /* not a host a URL parser accepts: nothing to say about it */
      }
    }
    return [...sentences];
  }
  return [];
}

/**
 * Every address a `mailto:` writes to (RFC 6068): the comma-separated list before the `?`, and
 * the `to`, `cc` and `bcc` fields after it. A code that hides a second address behind the first
 * is checked on both.
 */
function recipients(content: string): string[] {
  const body = content.slice('mailto:'.length);
  const query = body.indexOf('?');
  const head = query < 0 ? body : body.slice(0, query);
  const found = head.split(',').map(safeDecode);
  if (query >= 0) {
    for (const pair of body.slice(query + 1).split('&')) {
      const eq = pair.indexOf('=');
      const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
      if (['to', 'cc', 'bcc'].includes(key) && eq >= 0) {
        found.push(...safeDecode(pair.slice(eq + 1)).split(','));
      }
    }
  }
  return found.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Percent-decoding that never throws: a malformed escape is shown as it was written. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function describeContent(bytes: Uint8Array): Omit<ReadDescription, 'warnings'> {
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      kind: 'other',
      summary: 'Holds bytes that are not text',
      details: [`${bytes.length} bytes, shown as hexadecimal.`],
      content: hexDump(bytes),
      sensitive: false,
    };
  }
  const lower = text.toLowerCase();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = unicodeHost(url.hostname);
      const details = host.differs
        ? [`Shown as ${host.unicode}, resolves as ${host.punycode}.`]
        : [];
      return {
        kind: 'link',
        summary: describeLink(text),
        details,
        content: text,
        sensitive: false,
      };
    } catch {
      /* fall through to text */
    }
  }
  if (lower.startsWith('mailto:')) {
    const address = text.slice(7).split('?')[0] ?? '';
    return {
      kind: 'email',
      summary: `Writes to ${safeDecode(address)}`,
      details: [],
      content: text,
      sensitive: false,
    };
  }
  if (lower.startsWith('tel:')) {
    return {
      kind: 'phone',
      summary: `Calls ${text.slice(4)}`,
      details: [],
      content: text,
      sensitive: false,
    };
  }
  if (lower.startsWith('smsto:') || lower.startsWith('sms:')) {
    const rest = text.slice(text.indexOf(':') + 1);
    const number = rest.split(/[:?]/)[0] ?? '';
    return {
      kind: 'sms',
      summary: `Texts ${number}`,
      details: [],
      content: text,
      sensitive: false,
    };
  }
  if (lower.startsWith('wifi:')) {
    const fields = escapedFields(text.slice('WIFI:'.length));
    const details: string[] = [];
    if (fields['T']) details.push(`Security ${fields['T']}`);
    if (fields['H'] === 'true') details.push('Hidden network');
    return {
      kind: 'wifi',
      summary: `Joins ${fields['S'] ?? 'a network'}`,
      details,
      content: text,
      sensitive: Boolean(fields['P']),
    };
  }
  if (lower.startsWith('geo:')) {
    const [lat, lon] = text.slice(4).split('?')[0]?.split(',') ?? [];
    return {
      kind: 'geo',
      summary: `Opens the map at ${lat ?? '?'}, ${lon ?? '?'}`,
      details: [],
      content: text,
      sensitive: false,
    };
  }
  if (lower.startsWith('begin:vcard')) {
    const name =
      vcardField(text, 'FN') ?? vcardField(text, 'N')?.split(';').reverse().join(' ').trim();
    const details: string[] = [];
    const version = vcardField(text, 'VERSION');
    if (version) details.push(`vCard ${version}`);
    for (const field of ['ORG', 'TITLE', 'EMAIL', 'TEL', 'URL']) {
      const value = vcardField(text, field);
      if (value)
        details.push(
          `${field === 'ORG' ? 'Organisation' : field === 'TEL' ? 'Phone' : field === 'URL' ? 'Website' : field === 'EMAIL' ? 'E-mail' : 'Title'} ${value}`,
        );
    }
    return {
      kind: 'contact',
      summary: `Adds ${name || 'a contact'} to contacts`,
      details,
      content: text,
      sensitive: false,
    };
  }
  if (lower.startsWith('mecard:')) {
    const fields = escapedFields(text.slice('MECARD:'.length));
    const name = (fields['N'] ?? '').split(',').reverse().join(' ').trim();
    return {
      kind: 'contact',
      summary: `Adds ${name || 'a contact'} to contacts`,
      details: ['MECARD'],
      content: text,
      sensitive: false,
    };
  }
  return { kind: 'text', summary: 'Shows the text', details: [], content: text, sensitive: false };
}

/** The threshold under which a module is tight rather than comfortable, in millimetres. */
export const TIGHT_MODULE_MM = 0.4;

export type ScanVerdict = 'reads' | 'tight' | 'too small';

export interface WouldScan {
  moduleMm: number;
  verdict: ScanVerdict;
  sentence: string;
}

/** The quiet zone the standard asks for on every side, in modules; a printed code carries it. */
export const QUIET_ZONE_MODULES = 4;

/**
 * Whether a code of `symbolModules` modules a side — the symbol as a decoder reports it, quiet
 * zone excluded, 17 + 4 × version — would scan printed `widthMm` wide. The standard's quiet zone
 * is added here, once, because the printed width a person measures includes it and the number a
 * decoder reports does not; a screen that added it again would be wrong by a third.
 */
export function wouldScanAt(symbolModules: number, widthMm: number): WouldScan {
  const moduleMm = moduleSizeMm(symbolModules + 2 * QUIET_ZONE_MODULES, widthMm);
  const shown = Number(moduleMm.toFixed(2));
  const mm = String(Number(widthMm.toFixed(2)));
  if (shown >= MIN_MODULE_MM) {
    return {
      moduleMm,
      verdict: 'reads',
      sentence: `At ${mm} mm the modules are ${shown.toFixed(2)} mm — most cameras read that from 30 cm.`,
    };
  }
  if (shown >= TIGHT_MODULE_MM) {
    return {
      moduleMm,
      verdict: 'tight',
      sentence: `At ${mm} mm the modules are ${shown.toFixed(2)} mm — tight; a good camera reads it up close.`,
    };
  }
  return {
    moduleMm,
    verdict: 'too small',
    sentence: `At ${mm} mm the modules are ${shown.toFixed(2)} mm — too small for most cameras.`,
  };
}
