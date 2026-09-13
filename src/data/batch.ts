/**
 * The typed client for the batch commands (SPEC §2.8, F9).
 *
 * The interface never touches a file: a CSV is read by the host, the codes are written by the
 * host, and the report is written by the host from the string the domain composed. What crosses
 * this module is data — the planned rows on the way down, the outcome of each of them on the way
 * up — and nothing above this line knows `@tauri-apps` exists.
 *
 * A batch is long enough to watch, so the host talks back while it runs: an event per row with
 * the count so far. The subscription belongs to the screen that is watching (it is unsubscribed
 * when the screen goes away); the wire shape and the event's name belong here, with every other
 * fact about the host.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { RowStatus } from '@/domain/batch';

/** What a row is written as. A batch is one format, chosen once, for every row in it. */
export type BatchFormat = 'png' | 'svg';

export const BATCH_FORMAT_LABELS: Record<BatchFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
};

export const BATCH_FORMATS: readonly BatchFormat[] = ['png', 'svg'];

/**
 * Where the logo sits in one planned row, in that row's own modules. It is the placement the
 * domain computed for that code — a batch of two hundred codes is two hundred different boxes,
 * because the version the content needed is not the same for every row.
 */
export interface BatchRowLogo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One row on its way to the host: already planned, already drawn, not yet written. */
export interface BatchRow {
  line: number;
  /** The file's stem, sanitised by the domain; the host adds the extension and checks it again. */
  file: string;
  svg: string;
  payload: string;
  logo: BatchRowLogo | null;
  pixelSize: number;
}

export interface RunBatchRequest {
  folder: string;
  format: BatchFormat;
  dpi: number;
  rows: BatchRow[];
}

/** What became of one row. `reason` is empty for a row that was simply written. */
export interface BatchRowResult {
  line: number;
  file: string;
  status: RowStatus;
  reason: string;
}

export interface BatchReport {
  batchId: string;
  written: number;
  refused: number;
  failed: number;
  skipped: number;
  results: BatchRowResult[];
}

/** The counter behind the progress bar: one of these per row, while the batch runs. */
export interface BatchProgress {
  batchId: string;
  done: number;
  total: number;
  line: number;
  status: RowStatus;
}

export interface WriteBatchReportRequest {
  folder: string;
  /** The report, already composed by the domain (`reportCsv`); the host only writes it. */
  csv: string;
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawBatchRowResult {
  line: number;
  file: string;
  status: RowStatus;
  /** Absent or null for a row with nothing to say; read as the empty string. */
  reason?: string | null;
}

interface RawBatchReport {
  batch_id: string;
  written: number;
  refused: number;
  failed: number;
  skipped: number;
  results: RawBatchRowResult[];
}

interface RawBatchProgress {
  batch_id: string;
  done: number;
  total: number;
  line: number;
  status: RowStatus;
}

function result(raw: RawBatchRowResult): BatchRowResult {
  return { line: raw.line, file: raw.file, status: raw.status, reason: raw.reason ?? '' };
}

/**
 * Read a text file the person chose, as text.
 *
 * The host reads it because the interface may not: a path that arrived from a dialog is still a
 * path, and the rule that only the host touches the disk is the rule that keeps the size limit,
 * the encoding check and the local-path check in one place.
 */
export async function readTextFile(path: string): Promise<string> {
  const raw = await invoke<{ text: string }>('read_text_file', { path });
  return raw.text;
}

/**
 * Write every planned row into the chosen folder, each through the same gate a single export
 * passes. The command answers when the last row is done; a row that was refused or failed does
 * not stop the ones after it.
 */
export async function runBatch({
  folder,
  format,
  dpi,
  rows,
}: RunBatchRequest): Promise<BatchReport> {
  const raw = await invoke<RawBatchReport>('run_batch', {
    folder,
    format,
    dpi,
    rows: rows.map((row) => ({
      line: row.line,
      file: row.file,
      svg: row.svg,
      payload: row.payload,
      logo: row.logo,
      pixel_size: row.pixelSize,
    })),
  });
  return {
    batchId: raw.batch_id,
    written: raw.written,
    refused: raw.refused,
    failed: raw.failed,
    skipped: raw.skipped,
    results: raw.results.map(result),
  };
}

/** Stop after the row being written. The rest of the batch comes back as skipped. */
export async function cancelBatch(): Promise<void> {
  await invoke<null>('cancel_batch');
}

/** Write the report beside the codes. The path it went to is what the screen shows. */
export async function writeBatchReport({ folder, csv }: WriteBatchReportRequest): Promise<string> {
  const raw = await invoke<{ path: string }>('write_batch_report', { folder, csv });
  return raw.path;
}

/** The event the host emits once per row while a batch runs. */
export const BATCH_PROGRESS_EVENT = 'batch:progress';

/**
 * Watch a running batch. The returned function stops watching, and the screen that started
 * watching is the one that has to call it — a listener that outlives its screen is a leak that
 * updates a component nobody is looking at.
 */
export async function onBatchProgress(
  handle: (progress: BatchProgress) => void,
): Promise<UnlistenFn> {
  return listen<RawBatchProgress>(BATCH_PROGRESS_EVENT, (event) => {
    const raw = event.payload;
    handle({
      batchId: raw.batch_id,
      done: raw.done,
      total: raw.total,
      line: raw.line,
      status: raw.status,
    });
  });
}
