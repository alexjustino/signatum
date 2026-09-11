import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { ECLS, MASKS, encode, encodeBytes, type Ecl, type Matrix } from './encode';
import {
  alignmentCentres,
  checkFunctionPatterns,
  decodeFormat,
  decodeVersion,
  formatBits,
  readFormatBits,
  readVersionBits,
  sizeOfVersion,
  versionBits,
} from './structure';

/**
 * Known answers, taken from the standard's own tables rather than from any encoder.
 * ISO/IEC 18004 Table C.1 (format information) and Table D.1 (version information).
 */
const FORMAT_KNOWN: ReadonlyArray<[Ecl, number, string]> = [
  ['L', 0, '111011111000100'],
  ['M', 0, '101010000010010'],
  ['Q', 0, '011010101011111'],
  ['H', 0, '001011010001001'],
  ['M', 2, '101111001111100'],
];

const VERSION_KNOWN: ReadonlyArray<[number, string]> = [
  [7, '000111110010010100'],
  [8, '001000010110111100'],
  [21, '010101011010000011'],
  [40, '101000110001101001'],
];

/** ISO/IEC 18004 Table E.1, a sample of rows. */
const ALIGNMENT_KNOWN: ReadonlyArray<[number, number[]]> = [
  [1, []],
  [2, [6, 18]],
  [3, [6, 22]],
  [6, [6, 34]],
  [7, [6, 22, 38]],
  [10, [6, 28, 50]],
  [14, [6, 26, 46, 66]],
  [20, [6, 34, 62, 90]],
  [25, [6, 32, 58, 84, 110]],
  [30, [6, 26, 52, 78, 104, 130]],
  [32, [6, 34, 60, 86, 112, 138]],
  [35, [6, 30, 54, 78, 102, 126, 150]],
  [40, [6, 30, 58, 86, 114, 142, 170]],
];

/** Short enough to fit version 1 at level H (7 bytes), so every cell of the sweep is reachable. */
const MODES = {
  numeric: '0123456',
  alphanumeric: 'HELLO 1',
  byte: 'héllo',
} as const;

function decodeWithJsQr(m: Matrix, scale: number, quiet = 4): string | null {
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

describe('the standard, read back', () => {
  it.each(FORMAT_KNOWN)('format information for %s mask %i is %s', (ecl, mask, bits) => {
    expect(formatBits(ecl, mask).toString(2).padStart(15, '0')).toBe(bits);
    expect(decodeFormat(parseInt(bits, 2))).toEqual({ ecl, mask });
  });

  it('refuses a format string with a flipped bit', () => {
    expect(decodeFormat(parseInt('101010000010010', 2) ^ 1)).toBeNull();
  });

  it.each(VERSION_KNOWN)('version information for version %i is %s', (version, bits) => {
    expect(versionBits(version).toString(2).padStart(18, '0')).toBe(bits);
    expect(decodeVersion(parseInt(bits, 2))).toBe(version);
  });

  it.each(ALIGNMENT_KNOWN)('alignment centres of version %i', (version, centres) => {
    expect(alignmentCentres(version)).toEqual(centres);
  });

  it('knows the size of every version', () => {
    expect(sizeOfVersion(1)).toBe(21);
    expect(sizeOfVersion(40)).toBe(177);
  });
});

describe('every version, level, mode and mask', () => {
  it('draws every function pattern and carries the format and version it claims', () => {
    let checked = 0;
    for (let version = 1; version <= 40; version += 1) {
      for (const ecl of ECLS) {
        for (const [mode, text] of Object.entries(MODES)) {
          for (const mask of MASKS) {
            const m = encode(text, {
              ecl,
              minVersion: version,
              maxVersion: version,
              mask,
              boostEcl: false,
            });
            const label = `v${version} ${ecl} ${mode} mask ${mask}`;
            expect(m.size, label).toBe(sizeOfVersion(version));
            expect(m.version, label).toBe(version);
            expect(m.ecl, label).toBe(ecl);
            expect(m.mask, label).toBe(mask);
            expect(checkFunctionPatterns(m), label).toBeNull();
            const format = readFormatBits(m);
            expect(format.second, label).toBe(format.first);
            expect(decodeFormat(format.first), label).toEqual({ ecl, mask });
            const info = readVersionBits(m);
            if (version >= 7) {
              expect(info?.second, label).toBe(info?.first);
              expect(decodeVersion(info?.first ?? 0), label).toBe(version);
            } else {
              expect(info, label).toBeNull();
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(40 * 4 * 3 * 8);
  }, 120_000);

  it('decodes through a decoder of a different lineage at every version and level', () => {
    for (let version = 1; version <= 40; version += 1) {
      for (const ecl of ECLS) {
        // Version 1 at H carries 7 bytes; the URL below needs version 4 or more.
        const text =
          version <= 3
            ? 'ok'.repeat(version)
            : `https://example.com/v${version}/${ecl}?${'x'.repeat(version)}`;
        const m = encode(text, { ecl, minVersion: version, maxVersion: version });
        expect(m.version).toBe(version);
        expect(decodeWithJsQr(m, 3), `v${version} ${ecl}`).toBe(text);
      }
    }
  }, 180_000);

  it('carries arbitrary bytes in byte mode, and the same bytes come out', () => {
    const bytes = new Uint8Array([0, 255, 254, 1, 0x80, 0xc3, 0x28, 0x7f]);
    const m = encodeBytes(bytes, { ecl: 'M' });
    expect(m.version).toBe(1);
    // jsQR hands the bytes back as well as its text reading.
    const side = (m.size + 8) * 4;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < m.size; y += 1) {
      for (let x = 0; x < m.size; x += 1) {
        if (m.modules[y]?.[x] !== true) continue;
        for (let py = 0; py < 4; py += 1) {
          for (let px = 0; px < 4; px += 1) {
            const i = ((y + 4) * 4 + py) * side + (x + 4) * 4 + px;
            data[i * 4] = 0;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
          }
        }
      }
    }
    const read = jsQR(data, side, side);
    expect(read?.binaryData).toEqual(Array.from(bytes));
  });

  it('refuses a version range that is not one', () => {
    expect(() => encode('x', { ecl: 'L', minVersion: 0 })).toThrow();
    expect(() => encode('x', { ecl: 'L', maxVersion: 41 })).toThrow();
    expect(() => encode('x', { ecl: 'L', minVersion: 5, maxVersion: 4 })).toThrow();
    expect(() => encode('x', { ecl: 'L', minVersion: 1.5 })).toThrow();
  });

  it('refuses what does not fit in the version it was pinned to', () => {
    expect(() => encode('x'.repeat(100), { ecl: 'H', minVersion: 1, maxVersion: 1 })).toThrow();
  });
});
