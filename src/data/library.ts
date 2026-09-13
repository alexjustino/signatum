/**
 * The typed client for the library: saved codes and brand kits.
 *
 * The host keeps the JSON columns opaque — it validates that they are JSON and nothing more —
 * so the shape of what is inside them is owned on this side, and this file is the one place
 * that writes it and the one place that reads it back. Above this line a saved code is a form,
 * a look, a size and a logo reference; below it, four strings and two columns.
 *
 * A row that comes back with something unexpected in a JSON column is not allowed to reach a
 * screen as a half-typed object: what is missing falls back to the same defaults a new code
 * starts from, and a form whose kind is not one this product has is refused here. A stored code
 * that can no longer be made — a Wi-Fi whose password was deliberately not kept — is *not* a
 * parse failure: it parses, and the domain's `reopens` says why it cannot become a code yet.
 */

import { invoke } from '@tauri-apps/api/core';

import type { ChosenLogoRef, EclFloor } from '@/domain/library';
import { LOGO_SIZES, PLATES, type LogoSize, type Plate } from '@/domain/logo';
import { emptyForm, PAYLOAD_KINDS, type PayloadForm, type PayloadKind } from '@/domain/payload';
import { DEFAULT_STYLE, type Style } from '@/domain/scene';
import { DEFAULT_PRINT_SIZE, type PrintSize } from '@/domain/size';
import { FINDER_SHAPES, MODULE_SHAPES } from '@/domain/style';

/** A saved code as the list shows it: enough for a row, without its fields. */
export interface SavedCodeSummary {
  id: string;
  name: string;
  kind: PayloadKind;
  /** RFC 3339, as the host wrote it. */
  createdAt: string;
  updatedAt: string;
  /** The logo it uses, when it uses one — the bytes live in the logo store. */
  logoId: string | null;
}

/** A saved code in full: everything the Create screen needs to become it again. */
export interface SavedCode extends SavedCodeSummary {
  form: PayloadForm;
  style: Style;
  eclFloor: EclFloor | undefined;
  size: PrintSize;
  logo: ChosenLogoRef | null;
  /** The digest of the scene at save time (ADR-028): the rebuilt scene must hash the same. */
  sceneSha256: string;
}

/** A brand kit: a look, a size and a logo, with a name and nothing else. */
export interface BrandKit {
  id: string;
  name: string;
  createdAt: string;
  style: Style;
  eclFloor: EclFloor | undefined;
  size: PrintSize;
  logo: ChosenLogoRef | null;
}

/** What is saved, in the words of this side. */
export interface SaveCodeRequest {
  name: string;
  form: PayloadForm;
  style: Style;
  eclFloor: EclFloor | undefined;
  size: PrintSize;
  logo: ChosenLogoRef | null;
  sceneSha256: string;
}

export interface SaveBrandKitRequest {
  name: string;
  style: Style;
  eclFloor: EclFloor | undefined;
  size: PrintSize;
  logo: ChosenLogoRef | null;
}

// snake_case on the wire, camelCase above this line — translated once.

interface RawSavedCodeSummary {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  updated_at: string;
  logo_id: string | null;
}

interface RawSavedCode extends RawSavedCodeSummary {
  payload_json: string;
  style_json: string;
  size_json: string;
  logo_json: string | null;
  scene_sha256: string;
}

interface RawBrandKit {
  id: string;
  name: string;
  created_at: string;
  logo_id: string | null;
  logo_json: string | null;
  style_json: string;
  size_json: string;
}

/** The look as it is stored: the style's own fields, with the floor beside them. */
interface StoredStyle {
  foreground?: unknown;
  background?: unknown;
  quietZone?: unknown;
  moduleShape?: unknown;
  finderShape?: unknown;
  eclFloor?: unknown;
}

function parsed(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('a stored column has to hold a JSON object');
  }
  return value as Record<string, unknown>;
}

function isKind(value: unknown): value is PayloadKind {
  return PAYLOAD_KINDS.some((candidate) => candidate === value);
}

/**
 * The stored fields as a form. Over the empty form of its kind rather than on its own, so a
 * column written by an older version of this product — one field short — comes back as a
 * complete form with that field blank instead of as an object with a hole in it.
 */
function toForm(json: string): PayloadForm {
  const stored = parsed(json);
  const kind = stored.kind;
  if (!isKind(kind)) throw new Error('a saved code has to have a kind this product knows');
  const blank = emptyForm(kind);
  const merged: Record<string, unknown> = { ...blank };
  for (const [field, empty] of Object.entries(blank)) {
    const value = stored[field];
    // Field by field, and only where the stored value is the kind of thing that field holds: a
    // number where a string belongs is a corrupt column, not a form.
    if (typeof value === typeof empty) merged[field] = value;
  }
  merged.kind = kind;
  // Every field of the kind's empty form is present and of the right type — that is what the
  // loop above establishes — so this is the one place the check is traded for the type.
  return merged as unknown as PayloadForm;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toStyle(json: string): { style: Style; eclFloor: EclFloor | undefined } {
  const stored = parsed(json) as StoredStyle;
  const moduleShape = MODULE_SHAPES.find((candidate) => candidate === stored.moduleShape);
  const finderShape = FINDER_SHAPES.find((candidate) => candidate === stored.finderShape);
  const style: Style = {
    foreground: text(stored.foreground, DEFAULT_STYLE.foreground),
    background: text(stored.background, DEFAULT_STYLE.background),
    quietZone:
      typeof stored.quietZone === 'number' && Number.isInteger(stored.quietZone)
        ? stored.quietZone
        : DEFAULT_STYLE.quietZone,
    // Absent is the square default the scene draws without being asked, so a column that
    // never carried a shape reads the same as one that carried "square".
    ...(moduleShape === undefined ? {} : { moduleShape }),
    ...(finderShape === undefined ? {} : { finderShape }),
  };
  const floor = stored.eclFloor;
  return {
    style,
    eclFloor: floor === 'M' || floor === 'Q' || floor === 'H' ? floor : undefined,
  };
}

function toSize(json: string): PrintSize {
  const stored = parsed(json);
  return {
    value: typeof stored.value === 'number' ? stored.value : DEFAULT_PRINT_SIZE.value,
    unit: stored.unit === 'in' ? 'in' : 'mm',
    dpi: typeof stored.dpi === 'number' ? stored.dpi : DEFAULT_PRINT_SIZE.dpi,
  };
}

function toLogo(id: string | null, json: string | null): ChosenLogoRef | null {
  if (id === null) return null;
  const stored = json === null ? {} : parsed(json);
  const plate = PLATES.find((candidate) => candidate === stored.plate);
  const size = LOGO_SIZES.find((candidate) => candidate === stored.size);
  return {
    id,
    // A logo with a reference but no choices recorded is drawn the way a logo is chosen today:
    // on a square plate, as large as the budget allows.
    plate: (plate ?? 'square') as Plate,
    size: (size ?? 'largest') as LogoSize,
  };
}

function summary(raw: RawSavedCodeSummary): SavedCodeSummary {
  if (!isKind(raw.kind)) throw new Error('a saved code has to have a kind this product knows');
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    logoId: raw.logo_id,
  };
}

function code(raw: RawSavedCode): SavedCode {
  const look = toStyle(raw.style_json);
  return {
    ...summary(raw),
    form: toForm(raw.payload_json),
    style: look.style,
    eclFloor: look.eclFloor,
    size: toSize(raw.size_json),
    logo: toLogo(raw.logo_id, raw.logo_json),
    sceneSha256: raw.scene_sha256,
  };
}

function kit(raw: RawBrandKit): BrandKit {
  const look = toStyle(raw.style_json);
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.created_at,
    style: look.style,
    eclFloor: look.eclFloor,
    size: toSize(raw.size_json),
    logo: toLogo(raw.logo_id, raw.logo_json),
  };
}

/** The look on the wire: the style's fields and the floor, as one JSON object. */
function styleJson(style: Style, eclFloor: EclFloor | undefined): string {
  return JSON.stringify({ ...style, ...(eclFloor === undefined ? {} : { eclFloor }) });
}

function logoJson(logo: ChosenLogoRef | null): string | null {
  return logo === null ? null : JSON.stringify({ plate: logo.plate, size: logo.size });
}

/**
 * Keep this code. The form arrives already redacted by the domain when the person chose not to
 * keep a Wi-Fi password (ADR-018): what is handed over here is exactly what is written.
 */
export async function saveCode(request: SaveCodeRequest): Promise<SavedCode> {
  const raw = await invoke<RawSavedCode>('save_code', {
    name: request.name,
    kind: request.form.kind,
    payload_json: JSON.stringify(request.form),
    style_json: styleJson(request.style, request.eclFloor),
    size_json: JSON.stringify(request.size),
    logo_id: request.logo?.id ?? null,
    logo_json: logoJson(request.logo),
    scene_sha256: request.sceneSha256,
  });
  return code(raw);
}

/** Every saved code, newest first as the host orders them, without their fields. */
export async function listCodes(): Promise<SavedCodeSummary[]> {
  const raw = await invoke<RawSavedCodeSummary[]>('list_codes');
  return raw.map(summary);
}

/** One saved code in full — the fields a row draws its preview from, and Open loads. */
export async function getCode(id: string): Promise<SavedCode> {
  return code(await invoke<RawSavedCode>('get_code', { id }));
}

/** Give a saved code another name. The name is the domain's `checkName`'s before it gets here. */
export async function renameCode({ id, name }: { id: string; name: string }): Promise<void> {
  await invoke<null>('rename_code', { id, name });
}

/** Forget a saved code. The files already exported keep the code; the library does not. */
export async function deleteCode(id: string): Promise<void> {
  await invoke<null>('delete_code', { id });
}

/** Keep this look, this size and this logo under a name, for the next code. */
export async function saveBrandKit(request: SaveBrandKitRequest): Promise<BrandKit> {
  const raw = await invoke<RawBrandKit>('save_brand_kit', {
    name: request.name,
    logo_id: request.logo?.id ?? null,
    logo_json: logoJson(request.logo),
    style_json: styleJson(request.style, request.eclFloor),
    size_json: JSON.stringify(request.size),
  });
  return kit(raw);
}

export async function listBrandKits(): Promise<BrandKit[]> {
  const raw = await invoke<RawBrandKit[]>('list_brand_kits');
  return raw.map(kit);
}

export async function deleteBrandKit(id: string): Promise<void> {
  await invoke<null>('delete_brand_kit', { id });
}
