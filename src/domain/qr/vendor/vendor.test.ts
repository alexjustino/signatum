/**
 * The vendored encoder is pinned byte-for-byte to its upstream, apart from the two patches
 * documented in VENDORED.md. If this test fails, either upstream was updated (then update the
 * hash and the commit in VENDORED.md in the same commit) or someone edited a file that is not
 * ours to edit.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const UPSTREAM_SHA256 = '1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c';

const PATCH_1 = [
  '// @ts-nocheck -- vendored upstream source, checked by its own author; see VENDORED.md (patch 1)',
  '/* eslint-disable -- vendored upstream source; see VENDORED.md (patch 1) */',
];
const PATCH_2 =
  'export { qrcodegen }; // VENDORED.md (patch 2): the upstream file is a script; this makes it a module';

function vendoredSource(): string {
  return readFileSync(fileURLToPath(new URL('./qrcodegen.ts', import.meta.url)), 'utf8');
}

describe('the vendored encoder', () => {
  it('is upstream plus exactly the two documented patches', () => {
    const lines = vendoredSource().split('\n');
    expect(lines.slice(0, 2)).toEqual(PATCH_1);
    // The file ends with the patch line and a final newline.
    expect(lines.at(-1)).toBe('');
    expect(lines.at(-2)).toBe(PATCH_2);
    const upstream = lines.slice(2, -2).join('\n') + '\n';
    expect(createHash('sha256').update(upstream).digest('hex')).toBe(UPSTREAM_SHA256);
  });

  it('carries its MIT licence header', () => {
    expect(vendoredSource()).toContain('Copyright (c) Project Nayuki. (MIT License)');
  });
});
