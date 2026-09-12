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
 */

import { invoke } from '@tauri-apps/api/core';

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
}: ExportRequest): Promise<ExportReport> {
  const raw = await invoke<RawExportReport>('export_png', {
    svg,
    payload,
    pixel_size: pixelSize,
    path,
    logo: placementArg(logo),
  });
  return { ...report(raw), path: raw.path, bytesWritten: raw.bytes_written };
}
