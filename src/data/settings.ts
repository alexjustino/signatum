/**
 * The typed client for the settings table (F11).
 *
 * The host keeps settings as a key/value table of strings — the siblings' pattern — with a
 * closed list of keys and its own validation behind `settings_set`. Above this line a setting
 * is a theme, a width in millimetres, a resolution, a quiet zone and a yes/no; below it, two
 * strings.
 *
 * Reading is deliberately forgiving and writing is not. A row this build does not recognise, or
 * one carrying something that is not the number it should be — written by a newer version,
 * edited by hand — falls back to the built-in default rather than breaking a screen: a
 * preference is a convenience, and a screen that will not render is not. A write, on the other
 * hand, is the person's decision, and the host's refusal of it is shown in the host's own
 * sentence rather than guessed at here.
 *
 * The built-in defaults are not typed again here. They are the ones the product already starts
 * from — `DEFAULT_PRINT_SIZE`, `DEFAULT_STYLE`, `readTheme(null)` — so the value a fresh
 * workspace uses and the value the Create screen shows cannot drift apart.
 */

import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_STYLE, type Style } from '@/domain/scene';
import { readTheme, type ThemeChoice } from '@/domain/settings';
import {
  DEFAULT_PRINT_SIZE,
  DPI_CHOICES,
  MAX_PRINT_MM,
  MIN_PRINT_MM,
  toMillimetres,
  type PrintSize,
} from '@/domain/size';

/** The keys the table holds. The host refuses anything else; so does this. */
export const SETTING_KEYS = [
  'theme',
  'default_width_mm',
  'default_dpi',
  'default_quiet_zone',
  'keep_wifi_passwords',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Every setting, read. */
export interface Settings {
  theme: ThemeChoice;
  /** The printed width a new code starts at, always in millimetres — the table keeps one unit. */
  defaultWidthMm: number;
  defaultDpi: number;
  defaultQuietZone: number;
  /** Whether a saved Wi-Fi code keeps its password (ADR-018). */
  keepWifiPasswords: boolean;
}

/**
 * The quiet zone the scene will draw, in modules.
 *
 * The bounds are `renderScene`'s own rule — "a whole number of modules between 0 and 16" — and
 * they are named here because a settings field that offered a number the scene would throw on
 * is a default that breaks the next code somebody makes.
 */
export const MIN_QUIET_ZONE_MODULES = 0;
export const MAX_QUIET_ZONE_MODULES = 16;

/** The widths a code is printed between, in millimetres: the domain's own bounds. */
export const MIN_WIDTH_MM = MIN_PRINT_MM;
export const MAX_WIDTH_MM = MAX_PRINT_MM;

/**
 * What a workspace with no settings row is: exactly what the product starts from today.
 * Keeping a Wi-Fi password is on, because the code a person just verified carries it already
 * and a saved code that cannot be reopened is a surprise (ADR-018).
 */
export const BUILT_IN_SETTINGS: Settings = {
  theme: readTheme(null),
  defaultWidthMm: toMillimetres(DEFAULT_PRINT_SIZE),
  defaultDpi: DEFAULT_PRINT_SIZE.dpi,
  defaultQuietZone: DEFAULT_STYLE.quietZone,
  keepWifiPasswords: true,
};

/** One row of the table, as the host hands it over. */
interface RawSetting {
  key: string;
  value: string;
}

/** A number a stored string really is, or the built-in default instead of it. */
function readNumber(
  raw: string | undefined,
  fallback: number,
  accepts: (value: number) => boolean,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && accepts(value) ? value : fallback;
}

/** `true` and `false` are the two strings the table keeps; anything else is not an answer. */
function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

/** Read whatever the table holds as the settings this build understands. */
export function readSettings(rows: readonly RawSetting[]): Settings {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return {
    theme: readTheme(stored.get('theme')),
    defaultWidthMm: readNumber(
      stored.get('default_width_mm'),
      BUILT_IN_SETTINGS.defaultWidthMm,
      (value) => value >= MIN_WIDTH_MM && value <= MAX_WIDTH_MM,
    ),
    defaultDpi: readNumber(stored.get('default_dpi'), BUILT_IN_SETTINGS.defaultDpi, (value) =>
      DPI_CHOICES.includes(value),
    ),
    defaultQuietZone: readNumber(
      stored.get('default_quiet_zone'),
      BUILT_IN_SETTINGS.defaultQuietZone,
      (value) =>
        Number.isInteger(value) &&
        value >= MIN_QUIET_ZONE_MODULES &&
        value <= MAX_QUIET_ZONE_MODULES,
    ),
    keepWifiPasswords: readBoolean(
      stored.get('keep_wifi_passwords'),
      BUILT_IN_SETTINGS.keepWifiPasswords,
    ),
  };
}

/** Every setting at once — the one read the window makes, when it opens. */
export async function fetchSettings(): Promise<Settings> {
  return readSettings(await invoke<RawSetting[]>('settings_all'));
}

/**
 * One setting, as it is stored: a string, or nothing when the table has no row for it — or when
 * the row it has is one the host will not hand back. The reply is an object with room to grow
 * rather than a bare value, and this is where that shape stops.
 */
export async function readSetting(key: SettingKey): Promise<string | null> {
  const { value } = await invoke<{ value: string | null }>('settings_get', { key });
  return value;
}

/**
 * Keep a setting. The value is a string because the table is one; what a valid string is for a
 * given key is the host's rule, and its refusal arrives as the sentence to show.
 */
export async function writeSetting(key: SettingKey, value: string): Promise<void> {
  await invoke<null>('settings_set', { key, value });
}

/** The size a new code starts at. Millimetres, because that is the unit the table keeps. */
export function startingPrintSize(settings: Settings): PrintSize {
  return { value: settings.defaultWidthMm, unit: 'mm', dpi: settings.defaultDpi };
}

/** The look a new code starts with: the product's own, with the person's quiet zone. */
export function startingStyle(settings: Settings): Style {
  return { ...DEFAULT_STYLE, quietZone: settings.defaultQuietZone };
}
