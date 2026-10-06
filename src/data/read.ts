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
 * A third door (P2) checks a file this product exported: its stamp, recomputed by the host, and
 * whether this workspace holds the verification the stamp names. It answers a `StampCheck`, and
 * a PNG opened through the first door carries the same answer on its `Reading`.
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

/** The three kinds of file a stamp is checked on. */
export type StampedKind = 'png' | 'svg' | 'pdf';

/**
 * What a file's stamp says, checked against this workspace (P2).
 *
 * `decoder` is the one thing taken from the file. Everything that describes the verification —
 * when, as what, of which saved code — comes from this workspace's own row, and only when that
 * row matches the stamp (`matchesRecord`); a file that matches nothing here carries nothing else.
 */
export interface StampCheck {
  /** The file carries a stamp this build reads. */
  stamped: boolean;
  /** The file still matches its own stamp. False when there is no stamp. */
  intact: boolean;
  kind: StampedKind;
  /** The decoder the stamp names; null when there is no stamp. */
  decoder: string | null;
  /** This workspace holds a verification under the stamp's reference. */
  inWorkspace: boolean;
  /** …and that verification is of this payload and this file. */
  matchesRecord: boolean;
  /** When this workspace verified it, as ISO 8601 — from the workspace, never from the file. */
  verifiedAt: string | null;
  format: string | null;
  dpi: number | null;
  /** The saved code it was made from, while that code is still in the library. */
  codeId: string | null;
  codeName: string | null;
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
  /**
   * The stamp of a PNG opened from a file, when it carries one. Always null from the clipboard,
   * which carries pixels and never a file's stamp.
   */
  stamp: StampCheck | null;
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

interface RawStampCheck {
  stamped: boolean;
  intact: boolean;
  kind: StampedKind;
  decoder?: string | null;
  in_workspace: boolean;
  matches_record: boolean;
  verified_at?: string | null;
  format?: string | null;
  dpi?: number | null;
  code_id?: string | null;
  code_name?: string | null;
}

interface RawReading {
  width: number;
  height: number;
  preview: string;
  codes: RawReadCode[];
  note?: string | null;
  decode_ms: number;
  stamp?: RawStampCheck | null;
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

function stampCheck(raw: RawStampCheck): StampCheck {
  return {
    stamped: raw.stamped,
    intact: raw.intact,
    kind: raw.kind,
    decoder: raw.decoder ?? null,
    inWorkspace: raw.in_workspace,
    matchesRecord: raw.matches_record,
    verifiedAt: raw.verified_at ?? null,
    format: raw.format ?? null,
    dpi: raw.dpi ?? null,
    codeId: raw.code_id ?? null,
    codeName: raw.code_name ?? null,
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
    stamp: raw.stamp ? stampCheck(raw.stamp) : null,
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

/**
 * Check the stamp of the file at the chosen path — the third door (P2). The host reads a PNG,
 * an SVG or a PDF under the same caps as a picture, never renders it and never decodes it, and
 * answers with what the stamp says and whether this workspace holds the verification it names.
 * A file it will not check is a refusal with a sentence, like any other.
 */
export async function checkFile(path: string): Promise<StampCheck> {
  return stampCheck(await invoke<RawStampCheck>('check_file', { path }));
}
