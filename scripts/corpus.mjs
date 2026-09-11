// Generates the corpus that proves the matrix correct (SPEC §7, F1): ten thousand randomised
// payloads, encoded by the domain's encoder, written as one JSON object per line for the host's
// decoder to read back. Run through `npm run corpus:generate`, which builds the encoder first.
//
// The corpus is seeded, so two runs of the same encoder write the same file — a failure can be
// reproduced by its id. It is written under src-tauri/target/ and never committed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'src-tauri/target/corpus');
const OUT = resolve(OUT_DIR, 'corpus.ndjson');
const COUNT = 10_000;
const SEED = 20260911;

const { encode, encodeBytes, ECLS, MASKS } = await import(
  pathToFileURL(resolve(OUT_DIR, 'encoder.mjs')).href
);

/** xorshift32 — small, seeded, and good enough to spread payloads over the space. */
function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const random = rng(SEED);
const pick = (items) => items[Math.floor(random() * items.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const DIGITS = '0123456789';
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const ASCII = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_./?=&#@!,;';
const WIDE = ['ü', 'ç', 'ã', 'ß', 'é', '€', '日', '本', '語', '🙂', '—', '…'];

function text(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/** Lengths are skewed small — most codes in the world are — but reach version 40 now and then. */
function length(max) {
  const roll = random();
  if (roll < 0.55) return between(1, 40);
  if (roll < 0.85) return between(41, 400);
  return between(401, max);
}

function payloadFor(mode) {
  switch (mode) {
    case 'numeric':
      return text(DIGITS, length(7000));
    case 'alphanumeric':
      return text(ALPHANUMERIC, length(4200));
    default: {
      const n = length(2900);
      if (random() < 0.25) {
        let out = '';
        while (out.length < n) out += random() < 0.3 ? pick(WIDE) : text(ASCII, 1);
        return out;
      }
      return text(ASCII, n);
    }
  }
}

function pack(matrix) {
  const bits = matrix.size * matrix.size;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  let i = 0;
  for (const row of matrix.modules) {
    for (const dark of row) {
      if (dark) bytes[i >> 3] |= 0x80 >> (i & 7);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('base64');
}

const encoder = new TextEncoder();
const lines = [];
const histogram = new Map();

for (let id = 0; id < COUNT; id += 1) {
  const ecl = pick(ECLS);
  const mask = random() < 0.5 ? 'auto' : pick(MASKS);
  const minVersion = random() < 0.1 ? between(1, 40) : 1;
  const boostEcl = random() < 0.5;
  const options = { ecl, mask, minVersion, boostEcl };
  const mode = pick(['numeric', 'alphanumeric', 'byte', 'byte']);

  let payloadBytes;
  let matrix;
  // The last entry is bytes that are not UTF-8 at all: the decoder has to hand back bytes.
  if (id === COUNT - 1) {
    payloadBytes = Uint8Array.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0xa0, 0xa1, 0x01, 0x7f]);
    matrix = encodeBytes(payloadBytes, options);
  } else {
    let payload = payloadFor(mode);
    for (;;) {
      try {
        matrix = encode(payload, options);
        break;
      } catch {
        // Too long for version 40 at this level: halve it and try again.
        payload = payload.slice(0, Math.max(1, Math.floor(payload.length / 2)));
      }
    }
    payloadBytes = encoder.encode(payload);
  }

  histogram.set(matrix.version, (histogram.get(matrix.version) ?? 0) + 1);
  lines.push(
    JSON.stringify({
      id,
      payload: Buffer.from(payloadBytes).toString('base64'),
      ecl: matrix.ecl,
      version: matrix.version,
      mask: matrix.mask,
      size: matrix.size,
      modules: pack(matrix),
    }),
  );
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');

const versions = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
const covered = versions.length;
console.log(`corpus: ${COUNT} codes written to ${OUT}`);
console.log(
  `versions covered: ${covered} of 40; largest ${versions.at(-1)?.[0]}; ` +
    `version 1: ${histogram.get(1) ?? 0}, version 40: ${histogram.get(40) ?? 0}`,
);
if (covered < 40) {
  console.error('the corpus does not reach every version; change the seed or the lengths');
  process.exit(1);
}
