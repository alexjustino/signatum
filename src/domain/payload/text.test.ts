import { describe, expect, it } from 'vitest';

import { MAX_TEXT_BYTES, buildText, utf8ByteLength } from './text';

describe('buildText', () => {
  it('carries the text exactly as typed', () => {
    const text = 'Lote 42 — conferido ✅\nSegunda linha\tcom tabulação';
    const result = buildText({ kind: 'text', text });
    expect(result).toEqual({ ok: true, payload: text, summary: 'Shows the text' });
  });

  it('transforms nothing — trailing spaces are part of what was typed', () => {
    expect(buildText({ kind: 'text', text: 'SN 42  ' })).toMatchObject({ payload: 'SN 42  ' });
    expect(buildText({ kind: 'text', text: '  leading' })).toMatchObject({ payload: '  leading' });
  });

  it('accepts a payload exactly at the limit and refuses one byte more', () => {
    expect(buildText({ kind: 'text', text: 'a'.repeat(MAX_TEXT_BYTES) })).toMatchObject({
      ok: true,
    });
    expect(buildText({ kind: 'text', text: 'a'.repeat(MAX_TEXT_BYTES + 1) })).toEqual({
      ok: false,
      reason: `Text can be at most ${MAX_TEXT_BYTES} bytes long, and this is ${MAX_TEXT_BYTES + 1}.`,
      field: 'text',
    });
  });

  it('counts bytes, not characters — an accent costs two', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('✅')).toBe(3);
    const accented = 'é'.repeat(1477); // 2 954 bytes, one over the limit
    expect(utf8ByteLength(accented)).toBe(MAX_TEXT_BYTES + 1);
    expect(buildText({ kind: 'text', text: accented })).toMatchObject({
      ok: false,
      field: 'text',
    });
  });

  it.each([
    ['', 'Type the text to see its code.'],
    ['   ', 'Type the text to see its code.'],
    ['\n\t', 'Type the text to see its code.'],
  ])('refuses %j with a sentence', (text, reason) => {
    expect(buildText({ kind: 'text', text })).toEqual({ ok: false, reason, field: 'text' });
  });
});
