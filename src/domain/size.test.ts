import { describe, expect, it } from 'vitest';

import { encodeText } from './qr/encode';
import { renderScene } from './scene';
import {
  DEFAULT_PRINT_SIZE,
  MAX_PIXELS,
  MIN_PIXELS,
  checkPrintSize,
  formatMillimetres,
  moduleMillimetres,
  pixelsFor,
  pixelsPerMetre,
  sizedSvg,
  toMillimetres,
} from './size';

describe('size', () => {
  it('is 295 pixels for 25 mm at 300 dpi — the proof of done', () => {
    expect(pixelsFor(DEFAULT_PRINT_SIZE)).toBe(295);
    expect(pixelsFor({ value: 1, unit: 'in', dpi: 300 })).toBe(300);
    expect(pixelsFor({ value: 25, unit: 'mm', dpi: 600 })).toBe(591);
  });

  it('records 300 dpi as 11 811 pixels per metre', () => {
    expect(pixelsPerMetre(300)).toBe(11811);
    expect(pixelsPerMetre(150)).toBe(5906);
    expect(pixelsPerMetre(1200)).toBe(47244);
  });

  it('converts inches', () => {
    expect(toMillimetres({ value: 2, unit: 'in' })).toBeCloseTo(50.8, 6);
    expect(toMillimetres({ value: 25, unit: 'mm' })).toBe(25);
  });

  it('knows the width of a module on paper', () => {
    // A version-1 code with its quiet zone is 29 modules; at 25 mm that is 0.86 mm.
    expect(moduleMillimetres(29, DEFAULT_PRINT_SIZE)).toBeCloseTo(0.862, 3);
  });

  it('refuses a width outside the printable range, naming the field', () => {
    expect(checkPrintSize(DEFAULT_PRINT_SIZE)).toEqual({ ok: true });
    expect(checkPrintSize({ value: 4, unit: 'mm', dpi: 300 })).toMatchObject({
      ok: false,
      field: 'value',
      reason: 'A code is printed between 5 and 1000 mm wide.',
    });
    expect(checkPrintSize({ value: 0.1, unit: 'in', dpi: 300 })).toMatchObject({
      ok: false,
      reason: 'A code is printed between 0.2 and 39.4 in wide.',
    });
    expect(checkPrintSize({ value: 0, unit: 'mm', dpi: 300 })).toMatchObject({ field: 'value' });
    expect(checkPrintSize({ value: Number.NaN, unit: 'mm', dpi: 300 })).toMatchObject({
      field: 'value',
    });
    expect(checkPrintSize({ value: 25, unit: 'mm', dpi: 72 })).toMatchObject({ field: 'dpi' });
  });

  it('mirrors the raster bounds the host renders between', () => {
    // src-tauri/src/imaging/render.rs pins the same two numbers; a change to one side must
    // fail a test on that side.
    expect(MIN_PIXELS).toBe(64);
    expect(MAX_PIXELS).toBe(4096);
  });

  it('refuses a size and resolution the host would not render at, naming the resolution', () => {
    // 1000 mm at 1200 dpi is 47 244 pixels; the host stops at 4 096.
    expect(checkPrintSize({ value: 1000, unit: 'mm', dpi: 1200 })).toMatchObject({
      ok: false,
      field: 'dpi',
      reason: expect.stringContaining('47244 pixels wide'),
    });
    // 5 mm at 150 dpi is 30 pixels; the host needs 64.
    expect(checkPrintSize({ value: 5, unit: 'mm', dpi: 150 })).toMatchObject({
      ok: false,
      field: 'dpi',
      reason: expect.stringContaining('Raise the resolution'),
    });
    expect(checkPrintSize({ value: 5, unit: 'mm', dpi: 600 })).toEqual({ ok: true });
    expect(checkPrintSize({ value: 340, unit: 'mm', dpi: 300 })).toEqual({ ok: true });
    expect(checkPrintSize({ value: 350, unit: 'mm', dpi: 300 })).toMatchObject({ ok: false });
  });

  it('formats millimetres the way a person writes them', () => {
    expect(formatMillimetres(25)).toBe('25');
    expect(formatMillimetres(12.5)).toBe('12.5');
    expect(formatMillimetres(50.8)).toBe('50.8');
    expect(formatMillimetres(0.7549)).toBe('0.75');
  });

  it('sizes the SVG without touching what was verified', () => {
    const scene = renderScene(encodeText('https://example.com/', 'M'));
    const sized = sizedSvg(scene.svg, DEFAULT_PRINT_SIZE);
    expect(sized).toContain(`viewBox="0 0 ${scene.side} ${scene.side}" width="25mm" height="25mm"`);
    // Everything after the opening tag is byte-identical.
    const body = (s: string) => s.slice(s.indexOf('>') + 1);
    expect(body(sized)).toBe(body(scene.svg));
    expect(sizedSvg(scene.svg, { value: 2, unit: 'in', dpi: 300 })).toContain('width="50.8mm"');
    expect(() => sizedSvg('<svg></svg>', DEFAULT_PRINT_SIZE)).toThrow();
  });
});
