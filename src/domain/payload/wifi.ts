/**
 * A Wi-Fi network, in the ZXing `WIFI:` form both platforms' cameras read.
 *
 * This is the kind where escaping is the feature. The format separates its fields with `;` and
 * its keys from its values with `:`, so a network called `Bar;Grill` written straight into it
 * becomes two fields and the code joins a network that does not exist — or, worse, stops at a
 * name that matches something else. `\`, `;`, `,`, `:` and `"` are each prefixed with a
 * backslash, in the SSID and in the password, and the backslash is escaped first so that
 * escaping is not itself escapable (SPEC §5).
 *
 * `P:` is left out entirely for an open network rather than emitted empty, and `H:` appears only
 * when the network is hidden — the two things scanners disagree about when they are present and
 * blank. The password is not stored by this module; the screen says where it is stored
 * (SECURITY.md), and the domain only turns it into bytes.
 */

import { utf8ByteLength } from './text';

import type { PayloadResult } from './index';

export const WIFI_SECURITIES = ['WPA', 'WEP', 'nopass'] as const;
export type WifiSecurity = (typeof WIFI_SECURITIES)[number];

/** What each choice is called on screen. */
export const WIFI_SECURITY_LABELS: Record<WifiSecurity, string> = {
  WPA: 'WPA/WPA2/WPA3',
  WEP: 'WEP',
  nopass: 'No password',
};

export interface WifiForm {
  kind: 'wifi';
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

/** An SSID is 32 octets in IEEE 802.11, not 32 characters. */
export const MAX_SSID_BYTES = 32;
export const MIN_WPA_PASSWORD_LENGTH = 8;
export const MAX_WPA_PASSWORD_LENGTH = 63;

/** The reserved characters of the format, escaped with a backslash — the backslash first. */
const RESERVED = /([\\;,:"])/g;

export function escapeWifiValue(value: string): string {
  return value.replace(RESERVED, '\\$1');
}

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const HEXADECIMAL = /^[0-9a-fA-F]+$/;

function refuseWifiPassword(password: string, security: WifiSecurity): string | null {
  if (security === 'nopass') return null;
  if (password.length === 0) {
    return 'Type the network password, or choose an open network.';
  }
  if (security === 'WPA') {
    const length = [...password].length;
    if (length < MIN_WPA_PASSWORD_LENGTH) {
      return `A WPA password has to be at least ${MIN_WPA_PASSWORD_LENGTH} characters long.`;
    }
    if (length > MAX_WPA_PASSWORD_LENGTH) {
      return `A WPA password can be at most ${MAX_WPA_PASSWORD_LENGTH} characters long.`;
    }
    return null;
  }
  const length = password.length;
  const asciiKey = (length === 5 || length === 13) && PRINTABLE_ASCII.test(password);
  const hexadecimalKey = (length === 10 || length === 26) && HEXADECIMAL.test(password);
  if (!asciiKey && !hexadecimalKey) {
    return 'A WEP key has to be 5 or 13 characters, or 10 or 26 hexadecimal digits.';
  }
  return null;
}

export function buildWifi(form: WifiForm): PayloadResult {
  if (form.ssid.length === 0) {
    return { ok: false, reason: 'Type the network name to see its code.', field: 'ssid' };
  }
  const ssidBytes = utf8ByteLength(form.ssid);
  if (ssidBytes > MAX_SSID_BYTES) {
    return {
      ok: false,
      reason: `A network name can be at most ${MAX_SSID_BYTES} bytes long, and this is ${ssidBytes}.`,
      field: 'ssid',
    };
  }
  // The type says `security` is one of three words; the bytes must not trust the type, because
  // a tampered <select> can hand the form anything, and `T:` is a field delimiter's neighbour.
  if (!WIFI_SECURITIES.includes(form.security)) {
    return { ok: false, reason: 'Choose the security the network uses.', field: 'security' };
  }
  const passwordProblem = refuseWifiPassword(form.password, form.security);
  if (passwordProblem !== null) {
    return { ok: false, reason: passwordProblem, field: 'password' };
  }

  let payload = `WIFI:T:${form.security};S:${escapeWifiValue(form.ssid)};`;
  if (form.security !== 'nopass') {
    payload += `P:${escapeWifiValue(form.password)};`;
  }
  if (form.hidden) {
    payload += 'H:true;';
  }
  payload += ';';

  return { ok: true, payload, summary: `Joins ${form.ssid}` };
}
