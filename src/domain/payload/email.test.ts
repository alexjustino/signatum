import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES, MAX_SUBJECT_BYTES, buildEmail, type EmailForm } from './email';

const to = 'ana@example.com';

describe('buildEmail', () => {
  it('writes a mailto with the subject and the body percent-encoded as UTF-8', () => {
    const result = buildEmail({
      kind: 'email',
      to,
      subject: 'Wo ist Jürgen? A & B #1',
      body: 'Line one\nLine two',
    });
    expect(result).toEqual({
      ok: true,
      payload:
        'mailto:ana@example.com?subject=Wo%20ist%20J%C3%BCrgen%3F%20A%20%26%20B%20%231' +
        '&body=Line%20one%0ALine%20two',
      summary: 'Writes to ana@example.com',
    });
  });

  it('leaves out the query when there is nothing to put in it', () => {
    expect(buildEmail({ kind: 'email', to: '  ana@example.com  ', subject: '', body: '' })).toEqual(
      {
        ok: true,
        payload: 'mailto:ana@example.com',
        summary: 'Writes to ana@example.com',
      },
    );
  });

  it('carries a body with no subject', () => {
    expect(buildEmail({ kind: 'email', to, subject: '', body: 'Olá' })).toMatchObject({
      payload: 'mailto:ana@example.com?body=Ol%C3%A1',
    });
  });

  it('encodes a space as %20 and never as a plus', () => {
    const result = buildEmail({ kind: 'email', to, subject: 'a b', body: 'c+d' });
    expect(result).toMatchObject({ payload: 'mailto:ana@example.com?subject=a%20b&body=c%2Bd' });
  });

  it('does not let a subject typed into the address become a field', () => {
    const result = buildEmail({
      kind: 'email',
      to: 'ana?bcc=someone@example.org',
      subject: '',
      body: '',
    });
    expect(result).toEqual({
      ok: true,
      payload: 'mailto:ana%3Fbcc%3Dsomeone@example.org',
      summary: 'Writes to ana?bcc=someone@example.org',
    });
    expect(result).toMatchObject({ payload: expect.not.stringContaining('?bcc') });
  });

  it('keeps the delimiters RFC 6068 allows in an address', () => {
    expect(
      buildEmail({ kind: 'email', to: 'ana+lista@example.com', subject: '', body: '' }),
    ).toMatchObject({ payload: 'mailto:ana+lista@example.com' });
  });

  it('shows an internationalised domain as it will resolve', () => {
    const result = buildEmail({ kind: 'email', to: 'ana@bücher.example', subject: '', body: '' });
    expect(result).toEqual({
      ok: true,
      payload: 'mailto:ana@xn--bcher-kva.example',
      summary: 'Writes to ana@xn--bcher-kva.example',
    });
  });

  it('lowercases the domain and leaves the name alone', () => {
    expect(
      buildEmail({ kind: 'email', to: 'Ana.Souza@EXAMPLE.COM', subject: '', body: '' }),
    ).toMatchObject({
      payload: 'mailto:Ana.Souza@example.com',
      summary: 'Writes to Ana.Souza@example.com',
    });
  });

  it.each([
    ['', 'Type an e-mail address to see its code.'],
    ['   ', 'Type an e-mail address to see its code.'],
    ['ana souza@example.com', 'An e-mail address cannot contain spaces.'],
    ['example.com', 'An e-mail address needs an @, like ana@example.com.'],
    ['ana@example.com@example.org', 'An e-mail address can have only one @.'],
    ['ana@@example.com', 'An e-mail address can have only one @.'],
    ['@example.com', 'An e-mail address needs a name before the @.'],
    ['ana@', 'An e-mail address needs a domain after the @, like example.com.'],
    ['ana@example.com/path', 'That is not an e-mail domain. Write it like example.com.'],
    ['ana@example.com:25', 'That is not an e-mail domain. Write it like example.com.'],
    ['ana@exam#ple.com', 'That is not an e-mail domain. Write it like example.com.'],
    ['ana@exam\\ple.com', 'That is not an e-mail domain. Write it like example.com.'],
    ['ana@[203.0.113.1]', 'That is not an e-mail domain. Write it like example.com.'],
  ])('refuses %j with a sentence', (address, reason) => {
    expect(buildEmail({ kind: 'email', to: address, subject: '', body: '' })).toEqual({
      ok: false,
      reason,
      field: 'to',
    });
  });
});

const form: EmailForm = { kind: 'email', to, subject: '', body: '' };

describe('what a mail client would read as a second recipient', () => {
  it('encodes a comma and a semicolon in the local part', () => {
    expect(buildEmail({ ...form, to: 'ana,evil@example.com' })).toMatchObject({
      ok: true,
      payload: 'mailto:ana%2Cevil@example.com',
    });
    expect(buildEmail({ ...form, to: 'ana;evil@example.com' })).toMatchObject({
      ok: true,
      payload: 'mailto:ana%3Bevil@example.com',
    });
  });

  it('refuses a subject or a body that would not fit a code, naming the field', () => {
    expect(buildEmail({ ...form, subject: 'x'.repeat(MAX_SUBJECT_BYTES + 1) })).toMatchObject({
      ok: false,
      field: 'subject',
    });
    expect(buildEmail({ ...form, body: 'ü'.repeat(MAX_BODY_BYTES / 2 + 1) })).toMatchObject({
      ok: false,
      field: 'body',
    });
    expect(buildEmail({ ...form, body: 'x'.repeat(MAX_BODY_BYTES) })).toMatchObject({ ok: true });
  });
});
