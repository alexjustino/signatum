import { describe, expect, it } from 'vitest';

import { PAYLOAD_KINDS, PAYLOAD_LABELS, buildPayload, describePayload, emptyForm } from './index';

import type { PayloadForm, PayloadKind } from './index';

/** One valid form per kind, and the exact bytes it has to produce. */
const VALID: ReadonlyArray<{ form: PayloadForm; payload: string; summary: string }> = [
  {
    form: { kind: 'link', url: 'https://example.com' },
    payload: 'https://example.com/',
    summary: 'Opens example.com',
  },
  {
    form: { kind: 'text', text: 'Lote 42' },
    payload: 'Lote 42',
    summary: 'Shows the text',
  },
  {
    form: { kind: 'email', to: 'ana@example.com', subject: 'Oi', body: '' },
    payload: 'mailto:ana@example.com?subject=Oi',
    summary: 'Writes to ana@example.com',
  },
  {
    form: { kind: 'phone', number: '+55 11 99999-0000' },
    payload: 'tel:+5511999990000',
    summary: 'Calls +55 11 99999-0000',
  },
  {
    form: { kind: 'sms', number: '+55 11 99999-0000', message: 'Oi' },
    payload: 'SMSTO:+5511999990000:Oi',
    summary: 'Texts +55 11 99999-0000',
  },
  {
    form: {
      kind: 'wifi',
      ssid: 'Office-5G',
      password: 'hunter2hunter2',
      security: 'WPA',
      hidden: false,
    },
    payload: 'WIFI:T:WPA;S:Office-5G;P:hunter2hunter2;;',
    summary: 'Joins Office-5G',
  },
  {
    form: { kind: 'geo', latitude: '-23.5505', longitude: '-46.6333' },
    payload: 'geo:-23.5505,-46.6333',
    summary: 'Opens the map at -23.5505, -46.6333',
  },
];

describe('the payload kinds', () => {
  it('are offered in one order, from the most common to the most specific', () => {
    expect(PAYLOAD_KINDS).toEqual(['link', 'text', 'email', 'phone', 'sms', 'wifi', 'geo']);
  });

  it('each have a name on screen, and no name is used twice', () => {
    expect(Object.keys(PAYLOAD_LABELS).sort()).toEqual([...PAYLOAD_KINDS].sort());
    const labels = PAYLOAD_KINDS.map((kind) => PAYLOAD_LABELS[kind]);
    expect(labels).toEqual(['Link', 'Text', 'E-mail', 'Phone', 'SMS', 'Wi-Fi', 'Location']);
    expect(new Set(labels).size).toBe(PAYLOAD_KINDS.length);
  });

  it('are all covered by this suite', () => {
    expect(VALID.map((entry) => entry.form.kind)).toEqual([...PAYLOAD_KINDS]);
  });
});

describe('emptyForm', () => {
  it.each([...PAYLOAD_KINDS])('gives a blank %s form of that kind', (kind: PayloadKind) => {
    expect(emptyForm(kind).kind).toBe(kind);
  });

  it.each([...PAYLOAD_KINDS])('and a blank %s form is never a code', (kind: PayloadKind) => {
    const result = buildPayload(emptyForm(kind));
    expect(result.ok).toBe(false);
    // A refusal is a sentence, not a code and not a blank line.
    expect(result.ok ? '' : result.reason).toMatch(/\S.*\.$/);
  });
});

describe('buildPayload', () => {
  it.each(VALID)('builds the $form.kind payload byte for byte', ({ form, payload, summary }) => {
    expect(buildPayload(form)).toEqual({ ok: true, payload, summary });
  });

  it('names the field that is wrong, in the form the screen is showing', () => {
    expect(buildPayload({ kind: 'link', url: 'nope' })).toMatchObject({ field: 'url' });
    expect(buildPayload({ kind: 'text', text: '' })).toMatchObject({ field: 'text' });
    expect(buildPayload({ kind: 'email', to: '', subject: '', body: '' })).toMatchObject({
      field: 'to',
    });
    expect(buildPayload({ kind: 'phone', number: '' })).toMatchObject({ field: 'number' });
    expect(buildPayload({ kind: 'sms', number: '190', message: '' })).toMatchObject({
      field: 'message',
    });
    expect(
      buildPayload({
        kind: 'wifi',
        ssid: 'Office-5G',
        password: 'short',
        security: 'WPA',
        hidden: false,
      }),
    ).toMatchObject({ field: 'password' });
    expect(buildPayload({ kind: 'geo', latitude: '', longitude: '' })).toMatchObject({
      field: 'latitude',
    });
  });
});

describe('describePayload', () => {
  it.each(VALID)('says what scanning a $form.kind code does', ({ form, summary }) => {
    expect(describePayload(form)).toBe(summary);
  });

  it.each([...PAYLOAD_KINDS])('says why a blank %s form has no code yet', (kind: PayloadKind) => {
    const form = emptyForm(kind);
    const result = buildPayload(form);
    expect(describePayload(form)).toBe(result.ok ? result.summary : result.reason);
  });
});
