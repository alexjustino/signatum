import { describe, expect, it } from 'vitest';

import { checkHost, checkLink, SHORTENERS, type HostWarningKind } from './lookalike';

/** The host a URL parser produces for a typed address: what `checkHost` is handed. */
function hostOf(address: string): string {
  return new URL(`https://${address}/`).hostname;
}

function kinds(address: string): HostWarningKind[] {
  return checkHost(hostOf(address)).map((w) => w.kind);
}

describe('checkHost — the corpus', () => {
  // Each row: what was typed, and the warnings it must produce, in order.
  const corpus: Array<[string, HostWarningKind[]]> = [
    // Ordinary names, in any alphabet a real name uses: nothing to say.
    ['example.com', []],
    ['www.example.co.uk', []],
    ['bücher.example', []],
    ['münchen.de', []],
    ['中文.example', []],
    ['日本語とカタカナ.jp', []],
    ['한국어.kr', []],
    ['пример.рф', []],
    ['παράδειγμα.gr', []],
    ['my-shop-24.com', []],
    ['xn--bcher-kva.example', []],
    // One Cyrillic letter inside a Latin word.
    ['аpple.com', ['mixed-script']],
    ['pаypal.com', ['mixed-script']],
    ['gооgle.com', ['mixed-script']],
    // A whole label in Cyrillic or Greek that reads as a Latin word.
    ['аррlе.com', ['mixed-script']],
    ['ехаmрlе.com', ['mixed-script']],
    ['ѕсоре.com', ['imitation']],
    ['οικο.gr', []],
    ['οικο.com', ['imitation']],
    ['ѕсоре.ru', []],
    // A Latin letter that is not the ASCII one it imitates.
    ['ɡoogle.com', ['imitation']],
    ['ροκ.example', ['imitation']],
    // Two alphabets that are not a known mixture, without an imitation.
    ['shopмагазин.com', ['mixed-script']],
    // Shorteners: the redirect is somebody else's.
    ['bit.ly', ['shortener']],
    ['t.co', ['shortener']],
    ['tinyurl.com', ['shortener']],
    ['www.tinyurl.com', ['shortener']],
    ['qrco.de', ['shortener']],
    ['notbit.ly.example.com', []],
    // Addresses instead of names.
    ['93.184.216.34', ['ip-address']],
    ['192.168.0.10', ['ip-address']],
    ['10.0.0.1', ['ip-address']],
    ['[2606:2800:220:1:248:1893:25c8:1946]', ['ip-address']],
    ['[::1]', ['ip-address']],
  ];

  for (const [address, expected] of corpus) {
    it(`${address} → ${expected.length === 0 ? 'nothing' : expected.join(', ')}`, () => {
      expect(kinds(address)).toEqual(expected);
    });
  }
});

describe('checkHost — what is said', () => {
  it('names the word a mixed label imitates', () => {
    const [warning] = checkHost(hostOf('аpple.com'));
    expect(warning?.sentence).toBe(
      '“аpple” mixes Latin and Cyrillic letters: it reads as “apple”, but it is a different address.',
    );
  });

  it('names the word a whole label in another alphabet imitates', () => {
    const [warning] = checkHost(hostOf('ѕсоре.com'));
    expect(warning?.sentence).toContain(
      '“ѕсоре” is written in Cyrillic letters that look like the Latin “scope”',
    );
  });

  it('names a Latin letter that only looks like the plain one', () => {
    const [warning] = checkHost(hostOf('ɡoogle.com'));
    expect(warning?.sentence).toBe(
      '“ɡoogle” uses a letter that only looks like a plain Latin one: it reads as “google”, but it is a different address.',
    );
  });

  it('says a shortener decides where the code lands', () => {
    const [warning] = checkHost('bit.ly');
    expect(warning?.sentence).toBe(
      'bit.ly is a link shortener: the code opens a redirect, and where it lands is decided by whoever controls that short link, not by this code.',
    );
  });

  it('says a private address will not open from outside its network', () => {
    expect(checkHost('192.168.0.10')[0]?.sentence).toContain('private network');
    expect(checkHost('172.16.4.2')[0]?.sentence).toContain('private network');
    expect(checkHost('172.32.4.2')[0]?.sentence).toContain('raw IP address');
    expect(checkHost('93.184.216.34')[0]?.sentence).toContain('raw IP address');
    expect(checkHost('[fd00::1]')[0]?.sentence).toContain('private network');
  });

  it('lists the shorteners it knows, each a host on its own', () => {
    for (const s of SHORTENERS) expect(new URL(`https://${s}/`).hostname).toBe(s);
  });

  it('tolerates a trailing dot and upper case', () => {
    expect(checkHost('BIT.LY.').map((w) => w.kind)).toEqual(['shortener']);
  });
});

describe('checkLink', () => {
  it('checks the host of a link', () => {
    expect(checkLink('https://bit.ly/3abc').map((w) => w.kind)).toEqual(['shortener']);
    expect(checkLink('https://аpple.com/login').map((w) => w.kind)).toEqual(['mixed-script']);
    expect(checkLink('https://example.com/menu')).toEqual([]);
  });

  it('says nothing about what is not a link', () => {
    expect(checkLink('not a link')).toEqual([]);
  });
});
