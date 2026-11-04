/**
 * The typed client for the proof sheet (SPEC §10, P1).
 *
 * One page with the code at the sizes people actually print, each one rendered at its own raster
 * and read back before it is drawn. The domain decides which sizes go on the sheet and how many
 * pixels each one is (`proofSizes`); the host renders, verifies and writes. A size the domain
 * already refused, or one the decoder did not read back, comes back as a size that did not read,
 * with its sentence — it is a box on the page, never a picture.
 *
 * When no size reads, nothing is written and the command rejects with kind `refused`, exactly as
 * a single export does.
 */

import { invoke } from '@tauri-apps/api/core';

import type { ProofSize } from '@/domain/proof';

import { placementArg, type LogoPlacement } from './logos';

export interface ExportProofSheetRequest {
  /** The scene on screen — the string the gate verified, not the sized SVG. */
  svg: string;
  payload: string;
  /** Where the logo goes, in scene modules, exactly as the single exports send it. */
  logo?: LogoPlacement | null;
  dpi: number;
  /** The domain's plan, smallest first: what the host renders, and what it only draws a box for. */
  sizes: ProofSize[];
  /** What scanning the code does, in the domain's words — the sheet's second line. */
  summary: string;
  /** The domain's sentence for a chosen size the page cannot hold, or null. */
  note: string | null;
  path: string;
  /** The saved code this sheet is about, when the code on screen is one (F8). */
  codeId?: string | null;
}

/** What became of one size on the sheet. */
export interface ProofSizeResult {
  mm: number;
  chosen: boolean;
  /** True only when the decoder read the raster back as the payload and the picture was drawn. */
  verified: boolean;
  /** Why it is a box rather than a picture; null for a size that read. */
  reason: string | null;
  /** The verification row recorded for this size; null for a size the domain refused. */
  verificationId: string | null;
}

export interface ProofSheetReport {
  path: string;
  bytesWritten: number;
  /** The decoder that read every size, name and version. */
  decoder: string;
  sizes: ProofSizeResult[];
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawProofSizeResult {
  mm: number;
  chosen: boolean;
  verified: boolean;
  reason: string | null;
  verification_id: string | null;
}

interface RawProofSheetReport {
  path: string;
  bytes_written: number;
  decoder: string;
  sizes: RawProofSizeResult[];
}

/**
 * Render each size, read each one back, and write the sheet with the ones that read — or write
 * nothing, when none of them did.
 */
export async function exportProofSheet({
  svg,
  payload,
  logo = null,
  dpi,
  sizes,
  summary,
  note,
  path,
  codeId = null,
}: ExportProofSheetRequest): Promise<ProofSheetReport> {
  const raw = await invoke<RawProofSheetReport>('export_proof_sheet', {
    svg,
    payload,
    logo: placementArg(logo),
    dpi,
    sizes: sizes.map((size) => ({
      mm: size.mm,
      pixel_size: size.pixelSize,
      chosen: size.chosen,
      refused: size.refused,
    })),
    summary,
    note,
    path,
    code_id: codeId,
  });
  return {
    path: raw.path,
    bytesWritten: raw.bytes_written,
    decoder: raw.decoder,
    sizes: raw.sizes.map((size) => ({
      mm: size.mm,
      chosen: size.chosen,
      verified: size.verified,
      reason: size.reason,
      verificationId: size.verification_id,
    })),
  };
}
