import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256, sha256Bytes } from './sha256';

describe('sha256', () => {
  it("matches the standard's vectors", () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it("matches the platform's digest on the lengths that matter for padding", () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000, 4097]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 0xff);
      const reference = createHash('sha256').update(bytes).digest('hex');
      expect(sha256Bytes(bytes), `length ${length}`).toBe(reference);
    }
  });

  it('hashes UTF-8, not UTF-16', () => {
    const text = 'Café — ünïcödé ✅';
    expect(sha256(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });
});
