/**
 * The typed client for the logo store.
 *
 * A logo arrives as a path from the open dialog and comes back normalised: the
 * host decided what it really is from the magic bytes, re-encoded it into bytes
 * of our own making, and answered with the facts about what it stored — or
 * refused it with one sentence (DESIGN_SYSTEM §10). Nothing above this layer
 * ever sees the original file, and nothing here trusts an extension.
 *
 * The `note` is the host saying what normalisation changed — "Animated GIF: the
 * first frame is used." — and it is shown, not swallowed: a file that was
 * quietly altered is a surprise waiting to be found on paper.
 */

import { invoke } from '@tauri-apps/api/core';

/** Raster and vector are stored the same way; only the bytes differ. */
export type LogoKind = 'raster' | 'vector';

export interface LogoInfo {
  id: string;
  /** The sanitised file stem, as stored — what the thumbnail is named. */
  name: string;
  kind: LogoKind;
  /** What the bytes really were: `png`, `jpeg`, `gif`, `webp` or `svg`. */
  format: string;
  /** Pixels, or the SVG's viewBox. */
  width: number;
  height: number;
  /** One sentence about what normalisation changed, or null when nothing did. */
  note: string | null;
  /** Of the stored bytes, not of the file that was chosen. */
  sha256: string;
  /**
   * The stored bytes for the screen. The list command does not carry it — it is
   * null there, and `logoDataUrl` fetches it for a logo that needs showing.
   */
  dataUrl: string | null;
}

/**
 * Where the logo sits, in modules of the scene's coordinate system — the same
 * numbers the domain computed and the preview overlaid, so the host verifies
 * the picture a person is looking at rather than one like it.
 */
export interface LogoPlacement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawLogoInfo {
  id: string;
  name: string;
  kind: LogoKind;
  format: string;
  width: number;
  height: number;
  note: string | null;
  sha256: string;
  data_url?: string | null;
}

function info(raw: RawLogoInfo): LogoInfo {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    format: raw.format,
    width: raw.width,
    height: raw.height,
    note: raw.note,
    sha256: raw.sha256,
    dataUrl: raw.data_url ?? null,
  };
}

/** The wire shape of a placement: flat, and snake_case like every other argument. */
export function placementArg(placement: LogoPlacement | null): LogoPlacement | null {
  if (placement === null) return null;
  const { id, x, y, width, height } = placement;
  return { id, x, y, width, height };
}

/**
 * Read, decode, normalise and store the file at `path`. Rejects with the host's
 * sentence when the file is not an image this product will carry.
 */
export async function importLogo(path: string): Promise<LogoInfo> {
  return info(await invoke<RawLogoInfo>('import_logo', { path }));
}

/** Every stored logo, without its bytes. */
export async function listLogos(): Promise<LogoInfo[]> {
  const raw = await invoke<RawLogoInfo[]>('list_logos');
  return raw.map(info);
}

/** The stored bytes of one logo, as a data URL for the screen. */
export async function logoDataUrl(id: string): Promise<string> {
  return invoke<string>('logo_data_url', { id });
}

/** Forget a logo. The codes already exported keep the picture; the store does not. */
export async function deleteLogo(id: string): Promise<void> {
  await invoke<null>('delete_logo', { id });
}
