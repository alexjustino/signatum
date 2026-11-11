import { describe, expect, it } from 'vitest';

import { isTracking, withoutTracking } from './tracking';

describe('tracking parameters', () => {
  it('names the utm family and the click identifiers, and nothing else', () => {
    for (const name of [
      'utm_source',
      'UTM_Campaign',
      'utm_whatever',
      'fbclid',
      'gclid',
      'msclkid',
      'igshid',
    ]) {
      expect(isTracking(name), name).toBe(true);
    }
    for (const name of ['ref', 'id', 'page', 'q', 'token', 'utm', 'si', 'feature', 'source']) {
      expect(isTracking(name), name).toBe(false);
    }
  });

  it('takes them out and keeps everything else byte for byte', () => {
    expect(
      withoutTracking('https://example.com/menu?table=12&utm_source=flyer&utm_medium=print'),
    ).toEqual({ url: 'https://example.com/menu?table=12', removed: ['utm_source', 'utm_medium'] });
    // Encodings that a re-serialising parser would change are left exactly as they were.
    expect(withoutTracking('https://example.com/s?q=a+b%20c&fbclid=IwAR0x&name=%C3%A9')?.url).toBe(
      'https://example.com/s?q=a+b%20c&name=%C3%A9',
    );
  });

  it('drops a query it empties, and keeps the fragment', () => {
    expect(withoutTracking('https://example.com/?gclid=abc#menu')).toEqual({
      url: 'https://example.com/#menu',
      removed: ['gclid'],
    });
  });

  it('says nothing about a link without them', () => {
    expect(withoutTracking('https://example.com/menu')).toBeNull();
    expect(withoutTracking('https://example.com/menu?table=12')).toBeNull();
    expect(withoutTracking('https://example.com/#utm_source=x')).toBeNull();
  });

  it('leaves a malformed escape alone rather than guessing', () => {
    expect(withoutTracking('https://example.com/?%E0%A4%A=1&utm_source=x')?.url).toBe(
      'https://example.com/?%E0%A4%A=1',
    );
  });

  it('treats an encoded name as the name it decodes to', () => {
    expect(withoutTracking('https://example.com/?utm%5Fsource=x&a=1')?.url).toBe(
      'https://example.com/?a=1',
    );
  });
});
