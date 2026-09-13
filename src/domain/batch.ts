/**
 * The batch (SPEC §2.8): a CSV of links or contacts becomes one verified file per row, through
 * the very pipeline the Create screen uses, and a report of every row that could not be made
 * and why. Nothing here touches a file: the domain plans, names and reports; the host writes,
 * inside the folder that was chosen and nowhere else.
 */

import { defaultName } from './library';
import { buildPayload, type PayloadForm } from './payload';
import type { ContactForm } from './payload/contact';
import { type Plan, planCode } from './placement';
import { type LogoPlate, type Scene, type Style, renderScene } from './scene';
import { type PrintSize, pixelsFor } from './size';
import { describeCode } from './describe';

/** Every cap is a sentence before it is a number: a batch is a folder, not a firehose. */
export const MAX_BATCH_ROWS = 10_000;
export const MAX_ROW_BYTES = 64 * 1024;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export interface RowProblem {
  /** The line of the CSV the row started on, 1-based; the header is line 1. */
  line: number;
  reason: string;
}

export interface ParsedCsv {
  header: string[];
  /** Each row with the line it started on. */
  rows: Array<{ line: number; fields: string[] }>;
  problems: RowProblem[];
}

/** RFC 4180 with the tolerance a real export needs: LF or CRLF, a BOM, a trailing newline. */
export function parseCsv(text: string): ParsedCsv {
  const problems: RowProblem[] = [];
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    return {
      header: [],
      rows: [],
      problems: [{ line: 1, reason: 'This file is larger than 2 MB; a batch is at most that.' }],
    };
  }
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    field = '';
    const empty = fields.length === 1 && fields[0] === '';
    if (!empty) records.push({ line: startLine, fields });
    fields = [];
  };
  while (i < source.length) {
    const c = source[i] ?? '';
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      if (c === '\n') line += 1;
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.length === 0) {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      fields.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' && source[i + 1] === '\n') {
      endRecord();
      i += 2;
      line += 1;
      startLine = line;
      continue;
    }
    if (c === '\n') {
      endRecord();
      i += 1;
      line += 1;
      startLine = line;
      continue;
    }
    field += c;
    i += 1;
  }
  if (quoted) {
    problems.push({ line: startLine, reason: 'A quoted field is never closed.' });
  } else if (field.length > 0 || fields.length > 0) {
    endRecord();
  }
  const [head, ...rest] = records;
  if (head === undefined) {
    return { header: [], rows: [], problems: [{ line: 1, reason: 'The file is empty.' }] };
  }
  const header = head.fields.map((h) => h.trim().toLowerCase());
  const rows: ParsedCsv['rows'] = [];
  for (const record of rest) {
    if (rows.length >= MAX_BATCH_ROWS) {
      problems.push({
        line: record.line,
        reason: `A batch is at most ${MAX_BATCH_ROWS} rows; the rest were not read.`,
      });
      break;
    }
    const bytes = new TextEncoder().encode(record.fields.join(',')).length;
    if (bytes > MAX_ROW_BYTES) {
      problems.push({ line: record.line, reason: 'This row is longer than 64 KB.' });
      continue;
    }
    if (record.fields.length !== header.length) {
      problems.push({
        line: record.line,
        reason: `This row has ${record.fields.length} fields; the first line names ${header.length}.`,
      });
      continue;
    }
    rows.push(record);
  }
  return { header, rows, problems };
}

export type BatchKind = 'link' | 'contact';

const CONTACT_COLUMNS: Record<string, keyof Omit<ContactForm, 'kind' | 'format'>> = {
  given_name: 'givenName',
  family_name: 'familyName',
  organisation: 'organisation',
  organization: 'organisation',
  title: 'title',
  phone: 'phone',
  mobile: 'mobile',
  email: 'email',
  url: 'url',
  website: 'url',
  street: 'street',
  city: 'city',
  region: 'region',
  postcode: 'postcode',
  country: 'country',
  note: 'note',
};

/** What the header says the batch is, or the reason it says nothing usable. */
export function kindOfHeader(
  header: string[],
): { ok: true; kind: BatchKind } | { ok: false; reason: string } {
  const names = new Set(header);
  if (names.has('given_name') || names.has('family_name')) return { ok: true, kind: 'contact' };
  if (names.has('url')) return { ok: true, kind: 'link' };
  return {
    ok: false,
    reason:
      'The first line has to name the columns: "url" for links, or "given_name" and ' +
      '"family_name" (with "email", "phone", "organisation" and the rest) for contacts. ' +
      'A "name" column, when present, names the file.',
  };
}

/** The form a row describes, by the header's columns. */
export function formOfRow(kind: BatchKind, header: string[], fields: string[]): PayloadForm {
  const cell = (column: string): string => {
    const at = header.indexOf(column);
    return at >= 0 ? (fields[at] ?? '').trim() : '';
  };
  if (kind === 'link') return { kind: 'link', url: cell('url') };
  const contact: ContactForm = {
    kind: 'contact',
    format: (['vcard3', 'vcard4', 'mecard'] as const).find((f) => f === cell('format')) ?? 'vcard3',
    givenName: '',
    familyName: '',
    organisation: '',
    title: '',
    phone: '',
    mobile: '',
    email: '',
    url: '',
    street: '',
    city: '',
    region: '',
    postcode: '',
    country: '',
    note: '',
  };
  for (const [column, key] of Object.entries(CONTACT_COLUMNS)) {
    const value = cell(column);
    if (value.length > 0) contact[key] = value;
  }
  return contact;
}

const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'conin$',
  'conout$',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export const MAX_FILE_STEM = 80;

/**
 * A file name a person typed, made safe for a folder: one path segment, no separator, no
 * control character, no name Windows reserves, never `.` or `..`, never empty.
 */
export function sanitiseFileStem(raw: string): string {
  let stem = raw.normalize('NFC');
  // eslint-disable-next-line no-control-regex
  stem = stem.replace(/[\u0000-\u001f\u007f]/g, '');
  stem = stem.replace(/[\\/:*?"<>|]/g, '-');
  stem = stem.replace(/\s+/g, ' ').trim();
  stem = stem.replace(/^[. ]+|[. ]+$/g, '');
  if (stem.length > MAX_FILE_STEM) stem = stem.slice(0, MAX_FILE_STEM).replace(/[. ]+$/g, '');
  if (stem.length === 0) stem = 'code';
  const base = stem.split('.')[0]?.toLowerCase() ?? '';
  if (RESERVED.has(base)) stem = `code-${stem}`;
  return stem;
}

/** `007-Ana Souza`, unique within the batch, sortable by row. */
export function fileNameFor(index: number, wanted: string, taken: Set<string>): string {
  const prefix = String(index + 1).padStart(3, '0');
  const stem = sanitiseFileStem(wanted);
  let candidate = `${prefix}-${stem}`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${prefix}-${stem}-${n}`;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export interface BatchLook {
  style: Style;
  size: PrintSize;
  eclFloor?: 'M' | 'Q' | 'H';
  logo: { id: string; plate: LogoPlate['plate']; fraction?: number } | null;
}

export interface PlannedRow {
  line: number;
  name: string;
  file: string;
  form: PayloadForm;
  payload: string;
  scene: Scene;
  plan: Extract<Plan, { ok: true }>;
  pixelSize: number;
}

export interface BatchPlan {
  kind: BatchKind;
  rows: PlannedRow[];
  problems: RowProblem[];
}

/**
 * Every row through the Create pipeline. A row that cannot be made is a problem with its line
 * and the domain's own sentence, and the next row is planned all the same.
 */
export function planBatch(
  csv: ParsedCsv,
  look: BatchLook,
): BatchPlan | { ok: false; reason: string } {
  const kind = kindOfHeader(csv.header);
  if (!kind.ok) return kind;
  const problems = [...csv.problems];
  const rows: PlannedRow[] = [];
  const taken = new Set<string>();
  const nameAt = csv.header.indexOf('name');
  const pixelSize = pixelsFor(look.size);
  csv.rows.forEach((row, index) => {
    const form = formOfRow(kind.kind, csv.header, row.fields);
    const built = buildPayload(form);
    if (!built.ok) {
      problems.push({ line: row.line, reason: built.reason });
      return;
    }
    const plan = planCode(built.payload, {
      logo: look.logo !== null,
      quietZone: look.style.quietZone,
      padding: 1,
      ...(look.eclFloor !== undefined && { ecl: look.eclFloor }),
      ...(look.logo?.fraction !== undefined && { fraction: look.logo.fraction }),
    });
    if (!plan.ok) {
      problems.push({ line: row.line, reason: plan.reason });
      return;
    }
    const plate =
      look.logo !== null && plan.box !== null
        ? { box: plan.box, plate: look.logo.plate, padding: 1, colour: look.style.background }
        : undefined;
    let scene: Scene;
    try {
      scene = renderScene(plan.matrix, look.style, describeCode(built.summary), plate);
    } catch (error) {
      problems.push({
        line: row.line,
        reason: error instanceof Error ? error.message : 'This row could not be drawn.',
      });
      return;
    }
    const wanted =
      nameAt >= 0 && (row.fields[nameAt] ?? '').trim()
        ? (row.fields[nameAt] ?? '')
        : defaultName(form);
    rows.push({
      line: row.line,
      name: wanted.trim(),
      file: fileNameFor(index, wanted, taken),
      form,
      payload: built.payload,
      scene,
      plan,
      pixelSize,
    });
  });
  problems.sort((a, b) => a.line - b.line);
  return { kind: kind.kind, rows, problems };
}

export type RowStatus = 'written' | 'refused' | 'failed' | 'skipped';

export interface RowResult {
  line: number;
  name: string;
  file: string;
  status: RowStatus;
  reason: string;
}

/** A cell as a spreadsheet must see it: quoted when it needs to be, and never a formula. */
export function csvCell(value: string): string {
  let text = value.replace(/\r\n|\r/g, '\n');
  // The OWASP rule: a leading =, +, -, @, tab or carriage return would be evaluated by a
  // spreadsheet; a leading apostrophe makes it text. A negative number pays the same price.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** The batch report, itself a CSV: every row, its file, its status and the reason. */
export function reportCsv(results: RowResult[], problems: RowProblem[]): string {
  const lines = ['line,name,file,status,reason'];
  const all: Array<[number, string, string, string, string]> = [
    ...results.map((r): [number, string, string, string, string] => [
      r.line,
      r.name,
      r.file,
      r.status,
      r.reason,
    ]),
    ...problems.map((p): [number, string, string, string, string] => [
      p.line,
      '',
      '',
      'not made',
      p.reason,
    ]),
  ];
  all.sort((a, b) => a[0] - b[0]);
  for (const [line, name, file, status, reason] of all) {
    lines.push([String(line), csvCell(name), csvCell(file), status, csvCell(reason)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
