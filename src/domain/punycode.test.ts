import { describe, expect, it } from 'vitest';

import { decodePunycodeLabel, unicodeHost } from './punycode';

describe('punycode', () => {
  it('decodes the pairs a person will meet', () => {
    expect(decodePunycodeLabel('bcher-kva')).toBe('bücher');
    expect(decodePunycodeLabel('mnchen-3ya')).toBe('münchen');
    expect(decodePunycodeLabel('fiq228c')).toBe('中文');
    expect(decodePunycodeLabel('caf-dma')).toBe('café');
    expect(decodePunycodeLabel('espaol-zwa')).toBe('español');
  });

  it("matches the RFC's own sample", () => {
    // RFC 3492 §7.1 (A): Arabic (Egyptian).
    expect(decodePunycodeLabel('egbpdaj6bu4bxfgehfvwxn')).toBe('ليهمابتكلموشعربي؟');
  });

  it('returns null for what is not punycode, rather than a wrong name', () => {
    expect(decodePunycodeLabel('bcher-k!a')).toBeNull();
    expect(decodePunycodeLabel('')).toBe('');
  });

  it('refuses a label longer than a DNS label instead of throwing', () => {
    expect(decodePunycodeLabel('a'.repeat(64))).toBeNull();
    expect(() => decodePunycodeLabel('a-'.repeat(40000))).not.toThrow();
  });

  it('shows a host both ways, and says when they differ', () => {
    expect(unicodeHost('xn--bcher-kva.example')).toEqual({
      punycode: 'xn--bcher-kva.example',
      unicode: 'bücher.example',
      differs: true,
    });
    expect(unicodeHost('example.com')).toEqual({
      punycode: 'example.com',
      unicode: 'example.com',
      differs: false,
    });
    // The WHATWG parser is the source of the ASCII form; the two agree on a round trip.
    expect(unicodeHost(new URL('https://münchen.de/').hostname).unicode).toBe('münchen.de');
  });
});
