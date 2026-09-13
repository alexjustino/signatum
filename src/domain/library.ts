/**
 * The library (SPEC §2.7): a saved code is its fields — never a stored image — and the name of
 * the scene it made, so that opening it again rebuilds the same scene through the same domain
 * and the gate can verify it again. A brand kit is a logo, a look and a size, applied to a new
 * code in one click and leaving the payload alone.
 */

import type { LogoSize, Plate } from './logo';
import { buildPayload, type PayloadForm } from './payload';
import type { Ecl } from './qr/encode';
import type { Style } from './scene';
import { sha256 } from './sha256';
import type { PrintSize } from './size';

/** The lowest level a person may ask for; L is never offered (SPEC §2.4). */
export type EclFloor = Exclude<Ecl, 'L'>;

/** The logo as chosen for a code: which one, on what plate, at what size. */
export interface ChosenLogoRef {
  id: string;
  plate: Plate;
  size: LogoSize;
}

/** Everything that makes a code, as the library keeps it. */
export interface SavedCodeInput {
  name: string;
  form: PayloadForm;
  style: Style;
  eclFloor?: EclFloor;
  size: PrintSize;
  logo: ChosenLogoRef | null;
  /** The scene's SHA-256 at save time; on reopen the rebuilt scene must hash the same. */
  sceneSha256: string;
}

/** What a brand kit keeps: the look, the size and the logo — never a payload. */
export interface BrandKitInput {
  name: string;
  style: Style;
  eclFloor?: EclFloor;
  size: PrintSize;
  logo: ChosenLogoRef | null;
}

export const MAX_NAME_LENGTH = 80;

/** The name a code gets before the person gives it one. */
export function defaultName(form: PayloadForm): string {
  switch (form.kind) {
    case 'link':
      return hostOf(form.url) ?? 'Link';
    case 'text':
      return firstWords(form.text, 24) || 'Text';
    case 'email':
      return form.to.trim() || 'E-mail';
    case 'phone':
      return form.number.trim() || 'Phone';
    case 'sms':
      return form.number.trim() ? `Text ${form.number.trim()}` : 'SMS';
    case 'wifi':
      return form.ssid.trim() || 'Wi-Fi';
    case 'geo':
      return [form.latitude.trim(), form.longitude.trim()].filter(Boolean).join(', ') || 'Location';
    case 'contact':
      return [form.givenName.trim(), form.familyName.trim()].filter(Boolean).join(' ') || 'Contact';
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function firstWords(text: string, max: number): string {
  const line = text.trim().split(/\s+/).join(' ');
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut) + '…';
}

/** A name a code or a kit may carry: trimmed, one line, at most 80 characters, never empty. */
export function checkName(
  name: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return { ok: false, reason: 'Give it a name.' };
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `A name can be at most ${MAX_NAME_LENGTH} characters long.` };
  }
  return { ok: true, name: trimmed };
}

/**
 * The form as it is stored. A Wi-Fi password is kept in the clear unless the person chose not
 * to keep it (SECURITY.md; ADR-018) — then it is blank, and the reopened code asks for it again.
 */
export function redactForSave(form: PayloadForm, keepWifiPassword: boolean): PayloadForm {
  if (form.kind === 'wifi' && !keepWifiPassword) return { ...form, password: '' };
  return form;
}

/** Whether a stored form can still become a code as it is — a redacted Wi-Fi cannot. */
export function reopens(form: PayloadForm): { ok: true } | { ok: false; reason: string } {
  const built = buildPayload(form);
  return built.ok ? { ok: true } : { ok: false, reason: built.reason };
}

/** The name of a scene: the digest of its SVG, which is the digest of the code it draws. */
export function sceneHash(svg: string): string {
  return sha256(svg);
}

export interface AppliedKit {
  style: Style;
  eclFloor: EclFloor | undefined;
  size: PrintSize;
  logo: ChosenLogoRef | null;
}

/** What applying a kit sets — everything but the payload. */
export function applyKit(kit: BrandKitInput): AppliedKit {
  return {
    style: { ...kit.style },
    eclFloor: kit.eclFloor,
    size: { ...kit.size },
    logo: kit.logo === null ? null : { ...kit.logo },
  };
}
