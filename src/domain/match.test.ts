import { describe, expect, it } from 'vitest';

import { redactForSave } from './library';
import { describeMatch, matchSaved, payloadOfSaved } from './match';
import { emptyForm, type PayloadForm } from './payload';

type WifiForm = Extract<PayloadForm, { kind: 'wifi' }>;

const office: WifiForm = {
  ...(emptyForm('wifi') as WifiForm),
  ssid: 'Office-5G',
  password: 'hunter2hunter2',
};

const utf8 = (text: string) => new TextEncoder().encode(text);

const saved = (name: string, form: PayloadForm) => ({ id: name.toLowerCase(), name, form });

describe('payloadOfSaved', () => {
  it('is the string the builders make, the one the code carries', () => {
    expect(payloadOfSaved({ kind: 'link', url: 'https://example.com/menu' })).toBe(
      'https://example.com/menu',
    );
    expect(payloadOfSaved(office)).toBe('WIFI:T:WPA;S:Office-5G;P:hunter2hunter2;;');
  });

  it('is null for a Wi-Fi saved without its password', () => {
    expect(payloadOfSaved(redactForSave(office, false))).toBeNull();
  });

  it('is null for a form that is not a code yet', () => {
    expect(payloadOfSaved(emptyForm('link'))).toBeNull();
    expect(payloadOfSaved(emptyForm('contact'))).toBeNull();
  });

  it('is not null for an open network, which never had a password to keep', () => {
    expect(payloadOfSaved({ ...office, security: 'nopass', password: '' })).toBe(
      'WIFI:T:nopass;S:Office-5G;;',
    );
  });
});

describe('matchSaved', () => {
  const menu = saved('Menu', { kind: 'link', url: 'https://example.com/menu' });
  const table = saved('Table 12', { kind: 'text', text: 'Table 12' });
  const menuAgain = saved('Menu (print)', { kind: 'link', url: 'https://example.com/menu' });
  const library = [menu, table, menuAgain];

  it('finds the saved code whose payload is the bytes, byte for byte', () => {
    expect(matchSaved(utf8('Table 12'), library)).toEqual([table]);
  });

  it('accepts the payload as a string too', () => {
    expect(matchSaved('Table 12', library)).toEqual([table]);
  });

  it('keeps the order the list gave, when more than one carries the same thing', () => {
    expect(matchSaved(utf8('https://example.com/menu'), library)).toEqual([menu, menuAgain]);
    expect(matchSaved(utf8('https://example.com/menu'), [menuAgain, table, menu])).toEqual([
      menuAgain,
      menu,
    ]);
  });

  it('forgives nothing: a slash, a case, a space or a normalisation is another code', () => {
    expect(matchSaved(utf8('https://example.com/menu/'), library)).toEqual([]);
    expect(matchSaved(utf8('https://EXAMPLE.com/menu'), library)).toEqual([]);
    expect(matchSaved(utf8('Table 12 '), library)).toEqual([]);
    const cafe = saved('Café', { kind: 'text', text: 'Café' });
    expect(matchSaved(utf8('Café'), [cafe])).toEqual([]);
    expect(matchSaved(utf8('Café'), [cafe])).toEqual([cafe]);
  });

  it('keeps a byte-order mark as a byte, and so does not match without one', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Table 12')]);
    expect(matchSaved(bom, library)).toEqual([]);
  });

  it('matches nothing when the bytes are not UTF-8', () => {
    expect(matchSaved(new Uint8Array([0xff, 0xfe, 0x00]), library)).toEqual([]);
  });

  it('matches nothing on an empty code or an empty library', () => {
    expect(matchSaved(new Uint8Array(), library)).toEqual([]);
    expect(matchSaved(utf8('Table 12'), [])).toEqual([]);
  });

  it('never matches a Wi-Fi saved without its password, even on the network it names', () => {
    const redacted = saved('Office', redactForSave(office, false));
    const kept = saved('Office (kept)', office);
    const read = utf8('WIFI:T:WPA;S:Office-5G;P:hunter2hunter2;;');
    expect(matchSaved(read, [redacted, kept])).toEqual([kept]);
    expect(matchSaved(utf8('WIFI:T:WPA;S:Office-5G;P:;;'), [redacted])).toEqual([]);
  });

  it('matches a password only when it is the same password', () => {
    const kept = saved('Office', office);
    expect(matchSaved(utf8('WIFI:T:WPA;S:Office-5G;P:hunter2hunter3;;'), [kept])).toEqual([]);
  });
});

describe('describeMatch', () => {
  it('names the one saved code it matches', () => {
    expect(describeMatch(['Menu'])).toBe('Matches your saved code Menu');
  });

  it('counts them when there are more, and leaves the names to the list', () => {
    expect(describeMatch(['Menu', 'Menu (print)'])).toBe('Matches 2 of your saved codes');
  });
});
