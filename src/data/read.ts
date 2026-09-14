/**
 * The typed client for reading somebody else's code (SPEC §2.9, F10).
 *
 * Two doors, one answer. A path from the open dialog or whatever is on the clipboard goes to the
 * host, and what comes back is a `Reading`: the picture to show, the codes that were found in it
 * and one sentence about the reading itself. The interface never opens the file — the size cap,
 * the magic-bytes check and the local-path rule live in one place, and that place is not here.
 *
 * Nothing read is stored. A `Reading` exists for as long as the screen holding it does, which is
 * the whole promise of this screen: a photograph somebody dropped in is looked at, not kept.
 *
 * The bytes of a code arrive base64-encoded, because that is what survives JSON intact — a code
 * carries bytes, not text, and the lossy UTF-8 the host also sends is for the host's own logs,
 * never for deciding what a payload means. They are decoded here, once, so that everything above
 * this line has the bytes the domain describes.
 */

import { invoke } from '@tauri-apps/api/core';

/** The error-correction level a symbol was built at. */
export type Ecl = 'L' | 'M' | 'Q' | 'H';

/** One corner of a found code, in the pixels of the source image. */
export type Corner = readonly [number, number];

/** One code found in the image — or one code-like pattern that would not decode. */
export interface ReadCode {
  /** Exactly what the symbol carries. The meaning of these is the domain's to say. */
  bytes: Uint8Array;
  /** The same bytes as lossy UTF-8, as the host read them. */
  text: string;
  /** Null when the format information could not be read: the host invents no number. */
  version: number | null;
  ecl: Ecl | null;
  mask: number | null;
  /** Modules per side of the symbol, quiet zone excluded — `wouldScanAt` adds the quiet zone. */
  sideModules: number;
  /** The four corners the decoder found, in source pixels: what the overlay outlines. */
  corners: Corner[];
  /** Set when this pattern could not be decoded; then nothing else here means anything. */
  error: string | null;
}

/** What one image held. */
export interface Reading {
  /** The source image's own pixels — the coordinate system the corners are in. */
  width: number;
  height: number;
  /** The picture to show, already sized for the screen by the host. */
  preview: string;
  codes: ReadCode[];
  /** One sentence about the reading itself, or null when there is nothing to add. */
  note: string | null;
  decodeMs: number;
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawReadCode {
  bytes: string;
  text: string;
  version: number | null;
  ecl: Ecl | null;
  mask: number | null;
  side_modules: number;
  corners: number[][];
  error?: string | null;
}

interface RawReading {
  width: number;
  height: number;
  preview: string;
  codes: RawReadCode[];
  note?: string | null;
  decode_ms: number;
}

/**
 * The base64 the host sent, as the bytes it stands for.
 *
 * The fallback is the host's own lossy text rather than an empty code: a reading that arrived
 * with something in it must not be shown as a code carrying nothing. It is unreachable unless
 * the host is broken, and it is here so that a broken host is a wrong-looking card rather than a
 * blank screen.
 */
function bytesOf(base64: string, text: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new TextEncoder().encode(text);
  }
}

function code(raw: RawReadCode): ReadCode {
  return {
    bytes: bytesOf(raw.bytes, raw.text),
    text: raw.text,
    version: raw.version,
    ecl: raw.ecl,
    mask: raw.mask,
    sideModules: raw.side_modules,
    corners: raw.corners.map((point): Corner => [point[0] ?? 0, point[1] ?? 0]),
    error: raw.error ?? null,
  };
}

function reading(raw: RawReading): Reading {
  return {
    width: raw.width,
    height: raw.height,
    preview: raw.preview,
    codes: raw.codes.map(code),
    note: raw.note ?? null,
    decodeMs: raw.decode_ms,
  };
}

/**
 * Read the image at the chosen path. The host decides what the file really is from its bytes,
 * refuses it in one sentence when it is not something to read, and stores none of it.
 */
export async function readImage(path: string): Promise<Reading> {
  return reading(await invoke<RawReading>('read_image', { path }));
}

/**
 * Read whatever image is on the clipboard — the other door into this screen, and the one a
 * screenshot arrives through. An empty clipboard is a refusal with a sentence, like any other.
 */
export async function readClipboard(): Promise<Reading> {
  return reading(await invoke<RawReading>('read_clipboard', {}));
}
