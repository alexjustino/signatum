import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { ECLS, MAX_PAYLOAD_BYTES, encodeText, type Matrix } from './encode';

/** A finder pattern, as the standard draws it, read row by row. */
const FINDER = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];

function finderAt(m: Matrix, left: number, top: number): boolean {
  return FINDER.every((row, dy) =>
    [...row].every((cell, dx) => m.modules[top + dy]?.[left + dx] === (cell === '#')),
  );
}

/**
 * Rasterise a matrix into RGBA pixels with a quiet zone, the way a camera would see it, and hand
 * it to jsQR — a decoder of a different lineage from the encoder (ADR-011). This is the domain's
 * half of the scan gate; the host repeats it on the exact bytes it writes.
 */
function decodeWithJsQr(m: Matrix, scale = 4, quiet = 4): string | null {
  const side = (m.size + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < m.size; y += 1) {
    for (let x = 0; x < m.size; x += 1) {
      if (m.modules[y]?.[x] !== true) continue;
      for (let py = 0; py < scale; py += 1) {
        for (let px = 0; px < scale; px += 1) {
          const i = ((y + quiet) * scale + py) * side + (x + quiet) * scale + px;
          data[i * 4] = 0;
          data[i * 4 + 1] = 0;
          data[i * 4 + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side)?.data ?? null;
}

describe('encodeText', () => {
  it('puts a short link in version 1, 21 modules a side, at least at the level asked', () => {
    const m = encodeText('https://a.io/', 'L');
    expect(m.version).toBe(1);
    expect(m.size).toBe(21);
    // The encoder raises the level when it costs no extra version; it never lowers it.
    expect(ECLS.indexOf(m.ecl)).toBeGreaterThanOrEqual(ECLS.indexOf('L'));
    expect(m.modules).toHaveLength(21);
    expect(m.modules.every((row) => row.length === 21)).toBe(true);
  });

  it('draws the three finder patterns where the standard puts them', () => {
    const m = encodeText('https://example.com/', 'M');
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, m.size - 7, 0)).toBe(true);
    expect(finderAt(m, 0, m.size - 7)).toBe(true);
  });

  it('draws the timing patterns and the dark module', () => {
    const m = encodeText('https://example.com/', 'Q');
    for (let i = 8; i < m.size - 8; i += 1) {
      expect(m.modules[6]?.[i]).toBe(i % 2 === 0);
      expect(m.modules[i]?.[6]).toBe(i % 2 === 0);
    }
    // The dark module sits at column 8, row 4·version + 9.
    expect(m.modules[4 * m.version + 9]?.[8]).toBe(true);
  });

  it('never lowers the level that was asked for', () => {
    for (const ecl of ECLS) {
      expect(
        ECLS.indexOf(encodeText('https://example.com/path?q=1', ecl).ecl),
      ).toBeGreaterThanOrEqual(ECLS.indexOf(ecl));
    }
  });

  it('is deterministic', () => {
    const a = encodeText('https://signatum.example/', 'H');
    const b = encodeText('https://signatum.example/', 'H');
    expect(a).toEqual(b);
  });

  it('decodes byte-exact through a decoder of a different lineage, at every level', () => {
    const payloads = [
      'https://example.com/',
      'https://xn--bcher-kva.example/ünïcödé?x=1&y=2',
      'HELLO WORLD',
      '01234567890123456789',
      'https://example.com/' + 'a'.repeat(400),
    ];
    for (const payload of payloads) {
      for (const ecl of ECLS) {
        expect(decodeWithJsQr(encodeText(payload, ecl)), `${payload} @ ${ecl}`).toBe(payload);
      }
    }
  });

  it('refuses what does not fit in version 40', () => {
    expect(() => encodeText('x'.repeat(MAX_PAYLOAD_BYTES + 1), 'L')).toThrow();
    expect(encodeText('x'.repeat(MAX_PAYLOAD_BYTES), 'L').version).toBe(40);
  });
});
