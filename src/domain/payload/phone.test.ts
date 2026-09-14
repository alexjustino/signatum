import { describe, expect, it } from 'vitest';

import { MAX_PHONE_DIGITS, MIN_PHONE_DIGITS, buildPhone, parsePhoneNumber } from './phone';

describe('buildPhone', () => {
  it('strips the separators a dialler ignores and keeps the leading +', () => {
    const result = buildPhone({ kind: 'phone', number: '+55 (11) 99999-0000' });
    expect(result).toEqual({
      ok: true,
      payload: 'tel:+5511999990000',
      summary: 'Calls +55 (11) 99999-0000',
    });
  });

  it('accepts a national number with no country code', () => {
    expect(buildPhone({ kind: 'phone', number: '(11) 4002.8922' })).toEqual({
      ok: true,
      payload: 'tel:1140028922',
      summary: 'Calls (11) 4002.8922',
    });
  });

  it('shows the number as typed and dials the digits', () => {
    const result = parsePhoneNumber('  +1 202-555-0175  ');
    expect(result).toEqual({
      ok: true,
      number: { dialled: '+12025550175', display: '+1 202-555-0175' },
    });
  });

  it('lets a + lead and nowhere else', () => {
    expect(buildPhone({ kind: 'phone', number: '+551199999000' })).toMatchObject({ ok: true });
    expect(buildPhone({ kind: 'phone', number: '55+1199999000' })).toEqual({
      ok: false,
      reason: 'A phone number can have a + only at the start.',
      field: 'number',
    });
    expect(buildPhone({ kind: 'phone', number: '+55+11' })).toMatchObject({
      reason: 'A phone number can have a + only at the start.',
    });
  });

  it('accepts the shortest and the longest number and refuses either side of them', () => {
    expect(buildPhone({ kind: 'phone', number: '190' })).toMatchObject({ payload: 'tel:190' });
    expect(buildPhone({ kind: 'phone', number: '9'.repeat(MAX_PHONE_DIGITS) })).toMatchObject({
      ok: true,
    });
    expect(buildPhone({ kind: 'phone', number: '19' })).toMatchObject({
      reason: `A phone number needs at least ${MIN_PHONE_DIGITS} digits.`,
    });
    expect(buildPhone({ kind: 'phone', number: '9'.repeat(MAX_PHONE_DIGITS + 1) })).toMatchObject({
      reason: `A phone number can have at most ${MAX_PHONE_DIGITS} digits.`,
    });
  });

  it.each([
    ['', 'Type a phone number to see its code.'],
    ['   ', 'Type a phone number to see its code.'],
    [
      'CALL-ME',
      'A phone number can have only digits, a leading + and the separators ( ) - . and space.',
    ],
    [
      '+55 11 9999#0000',
      'A phone number can have only digits, a leading + and the separators ( ) - . and space.',
    ],
    [
      'tel:+5511999990000',
      'A phone number can have only digits, a leading + and the separators ( ) - . and space.',
    ],
  ])('refuses %j with a sentence', (number, reason) => {
    expect(buildPhone({ kind: 'phone', number })).toEqual({ ok: false, reason, field: 'number' });
  });
});
