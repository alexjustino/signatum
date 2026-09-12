/**
 * The typed client for the scan gate: verify, and export what was verified.
 *
 * Both commands rasterise the exact SVG the preview is showing and hand the
 * pixels to a decoder of a different lineage from the encoder that made them
 * (ADR-010, ADR-011). `verifyCode` writes nothing and is what the screen asks
 * while a person is still typing; `exportPng` writes the bytes it decoded — and
 * only those — so the file on disk is the artefact that passed.
 *
 * A code that does not decode is not a failure of this client: `verifyCode`
 * answers with `verified: false` and a reason. `exportPng` rejects instead,
 * with kind `refused`, because the export genuinely did not happen.
 *
 * Four ways out, one gate in front of all of them (F7): a PNG that carries the
 * resolution it was made at, an SVG whose width is in millimetres, a PDF whose
 * page is the printed size, and the clipboard. Each is verified before anything
 * is written or copied, at the pixel size the print asked for.
 */

import { invoke } from '@tauri-apps/api/core';

import type { ScanVariant } from '@/domain/describe';

import { placementArg, type LogoPlacement } from './logos';

export interface VerificationReport {
  /** True only when the decoded bytes are the payload bytes. */
  verified: boolean;
  /** The decoder that read it, name and version. */
  decoder: string;
  /** What the decoder read, or null when it found no code at all. */
  decoded: string | null;
  payloadSha256: string;
  decodedSha256: string | null;
  /** The hash of the PNG bytes that were decoded — the bytes an export writes. */
  artefactSha256: string;
  width: number;
  height: number;
  durationMs: number;
  /** One sentence when it did not verify; null when it did. */
  reason: string | null;
}

export interface ExportReport extends VerificationReport {
  path: string;
  bytesWritten: number;
}

export interface VerifyRequest {
  svg: string;
  payload: string;
  pixelSize: number;
  /**
   * Where the logo goes, in scene modules, when there is one. The scene SVG
   * carries the plate but not the logo, so the host draws the logo into the
   * pixmap before it decodes: what gets verified is the whole picture, logo
   * included, which is the only reading worth having.
   */
  logo?: LogoPlacement | null;
}

export interface ExportRequest extends VerifyRequest {
  path: string;
  /**
   * The resolution the raster was made at. The PNG records it in its `pHYs`
   * chunk, so a file opened in a layout application arrives at the physical size
   * it was designed for instead of at whatever the application assumes.
   */
  dpi: number;
}

/** A PDF is a page before it is an image: it needs the width in millimetres. */
export interface ExportPdfRequest extends ExportRequest {
  widthMm: number;
}

/** The clipboard takes the same picture, without a path to write it to. */
export interface CopyRequest extends VerifyRequest {
  dpi: number;
}

/** How the code holds up when it is shrunk, blurred and recompressed. */
export interface ScanMargin {
  variants: ScanVariant[];
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawVerificationReport {
  verified: boolean;
  decoder: string;
  decoded: string | null;
  payload_sha256: string;
  decoded_sha256: string | null;
  artefact_sha256: string;
  width: number;
  height: number;
  duration_ms: number;
  reason: string | null;
}

interface RawExportReport extends RawVerificationReport {
  path: string;
  bytes_written: number;
}

interface RawScanMargin {
  variants: ScanVariant[];
}

function report(raw: RawVerificationReport): VerificationReport {
  return {
    verified: raw.verified,
    decoder: raw.decoder,
    decoded: raw.decoded,
    payloadSha256: raw.payload_sha256,
    decodedSha256: raw.decoded_sha256,
    artefactSha256: raw.artefact_sha256,
    width: raw.width,
    height: raw.height,
    durationMs: raw.duration_ms,
    reason: raw.reason,
  };
}

/** Render and decode, writing nothing. What the scan-gate status shows. */
export async function verifyCode({
  svg,
  payload,
  pixelSize,
  logo = null,
}: VerifyRequest): Promise<VerificationReport> {
  const raw = await invoke<RawVerificationReport>('verify_code', {
    svg,
    payload,
    pixel_size: pixelSize,
    logo: placementArg(logo),
  });
  return report(raw);
}

/** Render, decode, compare — and write the file only if it decoded to the payload. */
export async function exportPng({
  svg,
  payload,
  pixelSize,
  path,
  logo = null,
  dpi,
}: ExportRequest): Promise<ExportReport> {
  const raw = await invoke<RawExportReport>('export_png', {
    svg,
    payload,
    pixel_size: pixelSize,
    path,
    logo: placementArg(logo),
    dpi,
  });
  return { ...report(raw), path: raw.path, bytesWritten: raw.bytes_written };
}

/**
 * Write the code as SVG: verified on the raster, written as the vector.
 *
 * The `svg` handed over is the domain's `sizedSvg` — the scene with its printed
 * width written in — because for this one format the bytes on disk are the
 * string this side produced rather than a picture the host encoded. The host
 * rasterises the same string to decide whether it may write it, and embeds the
 * logo from the bytes it already stored (ADR-026).
 */
export async function exportSvg({
  svg,
  payload,
  pixelSize,
  path,
  logo = null,
  dpi,
}: ExportRequest): Promise<ExportReport> {
  const raw = await invoke<RawExportReport>('export_svg', {
    svg,
    payload,
    pixel_size: pixelSize,
    path,
    logo: placementArg(logo),
    dpi,
  });
  return { ...report(raw), path: raw.path, bytesWritten: raw.bytes_written };
}

/**
 * Write the code as a one-page PDF whose page is exactly the printed size, with
 * the verified raster placed edge to edge — so "what was verified is what is
 * written" stays true of a format that is a page rather than an image.
 */
export async function exportPdf({
  svg,
  payload,
  pixelSize,
  path,
  logo = null,
  dpi,
  widthMm,
}: ExportPdfRequest): Promise<ExportReport> {
  const raw = await invoke<RawExportReport>('export_pdf', {
    svg,
    payload,
    pixel_size: pixelSize,
    path,
    logo: placementArg(logo),
    dpi,
    width_mm: widthMm,
  });
  return { ...report(raw), path: raw.path, bytesWritten: raw.bytes_written };
}

/**
 * Put the verified picture on the clipboard. The image only, never the payload
 * text: a payload left in the clipboard is a paste into the wrong window.
 */
export async function copyPng({
  svg,
  payload,
  pixelSize,
  logo = null,
  dpi,
}: CopyRequest): Promise<VerificationReport> {
  const raw = await invoke<RawVerificationReport>('copy_png', {
    svg,
    payload,
    pixel_size: pixelSize,
    logo: placementArg(logo),
    dpi,
  });
  return report(raw);
}

/**
 * How far the code can be degraded and still read: shrunk, blurred,
 * recompressed. A report about a code that already passed, never a gate on it
 * (ADR-027) — a variant that fails says so in a line and blocks nothing.
 */
export async function scanMargin({
  svg,
  payload,
  pixelSize,
  logo = null,
}: VerifyRequest): Promise<ScanMargin> {
  const raw = await invoke<RawScanMargin>('scan_margin', {
    svg,
    payload,
    pixel_size: pixelSize,
    logo: placementArg(logo),
  });
  return { variants: raw.variants };
}
