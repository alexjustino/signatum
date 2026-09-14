/**
 * Theme, density and the Windows accent colour.
 *
 * The accent ramp is read from the host and written straight into the token
 * layer, so the application follows the colour the user picked for their
 * desktop. Windows exposes a ramp rather than one colour precisely because the
 * shade that reads well on a light surface is not the shade that reads well on
 * a dark one — light themes take the darker steps, dark themes the lighter.
 */

import type { AccentRamp } from '@/data/system';
import { readTheme, type ThemeChoice } from '@/domain/settings';

export type { ThemeChoice };
export type Density = 'comfortable' | 'compact';

/**
 * The pre-paint copy of the choice, and nothing more.
 *
 * Since F11 the theme lives in the settings table with everything else a person chooses. The
 * browser store keeps a copy because reading the table is a host round trip and the first frame
 * cannot wait for it: `main.tsx` paints with this, the table answers a moment later and wins,
 * and the copy is written back for the next start. A store that disagrees with the table is
 * therefore corrected, never consulted twice. The domain stays out of it: it says what a theme
 * is, this says where it lives.
 */
const THEME_KEY = 'signatum.theme';

export function readStoredTheme(): ThemeChoice {
  try {
    return readTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    // A store that refuses to be read is not a reason to refuse to start.
    return readTheme(null);
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies to this window; it just will not survive it.
  }
}

/**
 * Apply the theme choice. `system` removes the attribute entirely so the
 * `prefers-color-scheme` rules take over — the default must be the absence of a
 * choice, not a third value the stylesheet has to know about.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

export function applyDensity(density: Density): void {
  document.documentElement.setAttribute('data-density', density);
}

/** True when the window is currently rendering dark, whatever the reason. */
export function isDark(): boolean {
  const choice = document.documentElement.getAttribute('data-theme');
  if (choice === 'dark') return true;
  if (choice === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Write the accent ramp into the token layer.
 *
 * Both themes are written at once, under their own selectors' variables, so a
 * theme switch needs no second call: light uses the base and darker steps for
 * contrast against white, dark uses the lighter steps against near-black.
 */
export function applyAccent(ramp: AccentRamp): void {
  const style = document.documentElement.style;

  if (isDark()) {
    style.setProperty('--accent-base', ramp.light2);
    style.setProperty('--accent-hover', ramp.light1);
    style.setProperty('--accent-active', ramp.accent);
    style.setProperty('--accent-subtle', withAlpha(ramp.light2, 0.12));
  } else {
    // Fluent's light theme fills with the first dark step, not the raw accent:
    // it is what keeps accent text readable on white and on its own tint.
    style.setProperty('--accent-base', ramp.dark1);
    style.setProperty('--accent-hover', ramp.dark2);
    style.setProperty('--accent-active', ramp.dark3);
    style.setProperty('--accent-subtle', withAlpha(ramp.dark1, 0.1));
  }
}

/** `#rrggbb` plus an alpha, as an `rgb()` with a slash — the token format. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
