import { describe, expect, it } from 'vitest';

import { MAX_SSID_BYTES, WIFI_SECURITIES, WIFI_SECURITY_LABELS, buildWifi } from './wifi';

import type { WifiForm, WifiSecurity } from './wifi';

const network: WifiForm = {
  kind: 'wifi',
  ssid: 'Office-5G',
  password: 'hunter2hunter2',
  security: 'WPA',
  hidden: false,
};

/**
 * A reader the way a camera reads it: split on *unescaped* `;`, then unescape each value. It is
 * here so the escaping tests assert what a scanner sees, not what the string looks like.
 */
function readWifiFields(payload: string): Record<string, string> {
  const body = payload.slice('WIFI:'.length, -1);
  const parts: string[] = [];
  let raw = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? '';
    if (character === '\\') {
      raw += character + (body[index + 1] ?? '');
      index += 1;
    } else if (character === ';') {
      parts.push(raw);
      raw = '';
    } else {
      raw += character;
    }
  }
  if (raw.length > 0) parts.push(raw);
  const fields: Record<string, string> = {};
  for (const part of parts) {
    fields[part.slice(0, 1)] = part.slice(2).replace(/\\(.)/g, '$1');
  }
  return fields;
}

describe('buildWifi', () => {
  it('writes the ZXing form both cameras read', () => {
    expect(buildWifi(network)).toEqual({
      ok: true,
      payload: 'WIFI:T:WPA;S:Office-5G;P:hunter2hunter2;;',
      summary: 'Joins Office-5G',
    });
  });

  it('leaves the password out of an open network', () => {
    expect(
      buildWifi({ ...network, security: 'nopass', password: 'ignored', ssid: 'Guest' }),
    ).toMatchObject({ payload: 'WIFI:T:nopass;S:Guest;;', summary: 'Joins Guest' });
  });

  it('writes H:true only for a hidden network', () => {
    expect(buildWifi({ ...network, hidden: true })).toMatchObject({
      payload: 'WIFI:T:WPA;S:Office-5G;P:hunter2hunter2;H:true;;',
    });
    expect(buildWifi({ ...network, security: 'nopass', hidden: true })).toMatchObject({
      payload: 'WIFI:T:nopass;S:Office-5G;H:true;;',
    });
    expect(buildWifi({ ...network, hidden: false })).toMatchObject({
      payload: expect.not.stringContaining('H:'),
    });
  });

  it('a semicolon in a network name does not become a second field', () => {
    const result = buildWifi({ ...network, ssid: 'a;b', password: 'passphrase' });
    expect(result).toMatchObject({ payload: 'WIFI:T:WPA;S:a\\;b;P:passphrase;;' });
    const fields = readWifiFields(result.ok ? result.payload : '');
    expect(fields).toEqual({ T: 'WPA', S: 'a;b', P: 'passphrase' });
    expect(Object.keys(fields)).toHaveLength(3);
  });

  it('escapes a comma in a password instead of splitting the value', () => {
    const result = buildWifi({ ...network, password: 'one,two,three' });
    expect(result).toMatchObject({ payload: 'WIFI:T:WPA;S:Office-5G;P:one\\,two\\,three;;' });
    expect(readWifiFields(result.ok ? result.payload : '').P).toBe('one,two,three');
  });

  it('escapes every reserved character, the backslash first', () => {
    const result = buildWifi({ ...network, ssid: 'Bar;Grill', password: 'p,ass"word:1\\2' });
    expect(result).toMatchObject({
      payload: 'WIFI:T:WPA;S:Bar\\;Grill;P:p\\,ass\\"word\\:1\\\\2;;',
    });
    const fields = readWifiFields(result.ok ? result.payload : '');
    expect(fields).toEqual({ T: 'WPA', S: 'Bar;Grill', P: 'p,ass"word:1\\2' });
  });

  it('does not let an escape be escaped away', () => {
    // A name ending in a backslash would otherwise escape the field separator itself.
    const result = buildWifi({ ...network, ssid: 'Lab\\', password: 'passphrase' });
    expect(result).toMatchObject({ payload: 'WIFI:T:WPA;S:Lab\\\\;P:passphrase;;' });
    expect(readWifiFields(result.ok ? result.payload : '')).toEqual({
      T: 'WPA',
      S: 'Lab\\',
      P: 'passphrase',
    });
  });

  it('accepts a WEP key of 5 or 13 characters, or 10 or 26 hexadecimal digits', () => {
    const wep = { ...network, security: 'WEP' as const, ssid: 'Lab' };
    expect(buildWifi({ ...wep, password: 'abcde' })).toMatchObject({
      payload: 'WIFI:T:WEP;S:Lab;P:abcde;;',
    });
    expect(buildWifi({ ...wep, password: 'abcdefghijklm' })).toMatchObject({ ok: true });
    expect(buildWifi({ ...wep, password: '0123456789' })).toMatchObject({ ok: true });
    expect(buildWifi({ ...wep, password: 'abcdef0123456789abcdef0123' })).toMatchObject({
      ok: true,
    });
    expect(buildWifi({ ...wep, password: 'Z'.repeat(26) })).toMatchObject({ ok: false });
    expect(buildWifi({ ...wep, password: 'abcdef' })).toEqual({
      ok: false,
      reason: 'A WEP key has to be 5 or 13 characters, or 10 or 26 hexadecimal digits.',
      field: 'password',
    });
  });

  it('holds the WPA passphrase to its 8 and its 63', () => {
    expect(buildWifi({ ...network, password: 'a'.repeat(8) })).toMatchObject({ ok: true });
    expect(buildWifi({ ...network, password: 'a'.repeat(63) })).toMatchObject({ ok: true });
    expect(buildWifi({ ...network, password: 'a'.repeat(7) })).toEqual({
      ok: false,
      reason: 'A WPA password has to be at least 8 characters long.',
      field: 'password',
    });
    expect(buildWifi({ ...network, password: 'a'.repeat(64) })).toEqual({
      ok: false,
      reason: 'A WPA password can be at most 63 characters long.',
      field: 'password',
    });
    expect(buildWifi({ ...network, password: '' })).toEqual({
      ok: false,
      reason: 'Type the network password, or choose an open network.',
      field: 'password',
    });
  });

  it('measures the network name in bytes, as the radio does', () => {
    expect(buildWifi({ ...network, ssid: 'a'.repeat(MAX_SSID_BYTES) })).toMatchObject({ ok: true });
    expect(buildWifi({ ...network, ssid: 'a'.repeat(MAX_SSID_BYTES + 1) })).toEqual({
      ok: false,
      reason: `A network name can be at most ${MAX_SSID_BYTES} bytes long, and this is ${MAX_SSID_BYTES + 1}.`,
      field: 'ssid',
    });
    // Sixteen accented characters are 32 bytes; seventeen are 34 and do not fit.
    expect(buildWifi({ ...network, ssid: 'é'.repeat(16) })).toMatchObject({ ok: true });
    expect(buildWifi({ ...network, ssid: 'é'.repeat(17) })).toMatchObject({
      ok: false,
      field: 'ssid',
    });
  });

  it('refuses an empty network name with a sentence', () => {
    expect(buildWifi({ ...network, ssid: '' })).toEqual({
      ok: false,
      reason: 'Type the network name to see its code.',
      field: 'ssid',
    });
  });

  it('names every security choice on screen', () => {
    expect(WIFI_SECURITIES).toEqual(['WPA', 'WEP', 'nopass']);
    for (const security of WIFI_SECURITIES) {
      expect(WIFI_SECURITY_LABELS[security].length).toBeGreaterThan(0);
    }
  });
});

describe('the security field', () => {
  it('is refused when it is not one of the three words, whatever the type says', () => {
    const tampered = { ...network, security: 'WPA;S:evil' as unknown as WifiSecurity };
    expect(buildWifi(tampered)).toMatchObject({ ok: false, field: 'security' });
  });
});
