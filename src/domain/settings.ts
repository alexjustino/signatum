/**
 * The theme: the first thing a person chose in this product, and the shape every choice takes.
 *
 * Pure data with a reader that never throws. A stored value this build does not
 * recognise — written by a newer version, or edited by hand — falls back to the
 * default rather than breaking the screen, because a preference is a
 * convenience and a screen that will not render is not.
 *
 * Where the choice is kept is not decided here. The domain neither reads nor
 * writes it; `app/theme.ts` does that, and hands the raw value to `readTheme`.
 * Since F11 it lives in the workspace's `settings` table with the other choices (ADR-031),
 * with the browser store kept only as the pre-paint mirror so that no window ever flashes the
 * wrong theme.
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeChoice = 'system';

/** What each choice is called on screen. */
export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Match Windows',
  light: 'Light',
  dark: 'Dark',
};

/** Read a stored value — anything at all — as a theme choice. */
export function readTheme(raw: unknown): ThemeChoice {
  return (THEMES as readonly unknown[]).includes(raw) ? (raw as ThemeChoice) : DEFAULT_THEME;
}
