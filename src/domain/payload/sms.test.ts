import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES, buildSms, type SmsForm } from './sms';

describe('buildSms', () => {
  it('writes SMSTO with the dialled number and the message as typed', () => {
    const result = buildSms({
      kind: 'sms',
      number: '+55 (11) 99999-0000',
      message: 'Olá! Chego às 10:30.',
    });
    expect(result).toEqual({
      ok: true,
      payload: 'SMSTO:+5511999990000:Olá! Chego às 10:30.',
      summary: 'Texts +55 (11) 99999-0000',
    });
  });

  it('keeps the line breaks in a message', () => {
    const message = 'First line\nSecond line';
    expect(buildSms({ kind: 'sms', number: '+5511999990000', message })).toMatchObject({
      payload: `SMSTO:+5511999990000:${message}`,
    });
  });

  it('needs no escaping in the message — only the number carries a delimiter', () => {
    const message = 'a:b;c,d\\e"f';
    const result = buildSms({ kind: 'sms', number: '190', message });
    expect(result).toMatchObject({ payload: `SMSTO:190:${message}` });
    // The number is digits and one leading plus, so the first colon after it is the last one
    // the format owns: everything past it is the message, whatever it contains.
    const payload = result.ok ? result.payload : '';
    expect(payload.slice(payload.indexOf(':', 'SMSTO:'.length) + 1)).toBe(message);
  });

  it('refuses a number it would not dial, and says which field', () => {
    expect(buildSms({ kind: 'sms', number: '', message: 'Hello' })).toEqual({
      ok: false,
      reason: 'Type a phone number to see its code.',
      field: 'number',
    });
    expect(buildSms({ kind: 'sms', number: '55+11', message: 'Hello' })).toEqual({
      ok: false,
      reason: 'A phone number can have a + only at the start.',
      field: 'number',
    });
  });

  it.each([
    ['', 'Type the message the text will carry.'],
    ['   ', 'Type the message the text will carry.'],
  ])('refuses the message %j with a sentence', (message, reason) => {
    expect(buildSms({ kind: 'sms', number: '+5511999990000', message })).toEqual({
      ok: false,
      reason,
      field: 'message',
    });
  });
});

const form: SmsForm = { kind: 'sms', number: '+55 11 99999-0000', message: 'hi' };

describe('a message that would not fit a code', () => {
  it('is refused with the field named', () => {
    expect(buildSms({ ...form, message: 'x'.repeat(MAX_MESSAGE_BYTES + 1) })).toMatchObject({
      ok: false,
      field: 'message',
    });
    expect(buildSms({ ...form, message: 'x'.repeat(MAX_MESSAGE_BYTES) })).toMatchObject({
      ok: true,
    });
  });
});
