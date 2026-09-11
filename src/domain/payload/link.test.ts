import { describe, expect, it } from 'vitest';

import { MAX_LINK_LENGTH, describeLink, parseLink } from './link';

describe('parseLink', () => {
  it('accepts https and http and normalises what a browser would', () => {
    expect(parseLink('https://Example.com')).toEqual({
      ok: true,
      url: 'https://example.com/',
      host: 'example.com',
    });
    expect(parseLink('  http://example.com/a b'.trim())).toMatchObject({ ok: false });
    expect(parseLink('http://example.com/path?q=1#top')).toMatchObject({
      ok: true,
      url: 'http://example.com/path?q=1#top',
    });
  });

  it('shows an internationalised host as it will resolve', () => {
    const result = parseLink('https://bücher.example/');
    expect(result).toMatchObject({ ok: true, host: 'xn--bcher-kva.example' });
  });

  it.each([
    ['', 'Type a link to see its code.'],
    ['   ', 'Type a link to see its code.'],
    ['example.com', 'That is not a link. It has to start with https:// or http://.'],
    ['ftp://example.com/', 'A link has to start with https:// or http://.'],
    ['javascript:alert(1)', 'A link has to start with https:// or http://.'],
    ['file:///C:/x', 'A link has to start with https:// or http://.'],
    ['mailto:someone@example.com', 'A link has to start with https:// or http://.'],
    ['https://', 'That is not a link. It has to start with https:// or http://.'],
    [
      'https://user:pw@example.com/',
      'A link with a user name or a password in it is not accepted.',
    ],
    ['https://example.com/a b', 'A link cannot contain spaces.'],
    ['https://example.com/' + 'a'.repeat(MAX_LINK_LENGTH), expect.stringContaining('at most')],
  ])('refuses %j with a sentence', (input, reason) => {
    expect(parseLink(input)).toEqual({ ok: false, reason });
  });
});

describe('describeLink', () => {
  it('names the host the phone will open', () => {
    expect(describeLink('https://example.com/some/path')).toBe('Opens example.com');
    expect(describeLink('https://xn--bcher-kva.example/')).toBe('Opens xn--bcher-kva.example');
  });

  it('degrades to a sentence rather than throwing', () => {
    expect(describeLink('not a url')).toBe('Opens a link');
  });
});
