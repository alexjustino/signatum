/**
 * The scene: a matrix and a style become one self-contained SVG. The same string is shown on
 * screen, rasterised by the host for verification, and — in F7 — written as the SVG export, so
 * that what was verified is what leaves.
 *
 * The SVG has no external reference, no script, no font and no image: one background rectangle
 * and one path of dark modules. Colours are the person's print colours (DESIGN_SYSTEM §2,
 * "Colour and the code"): they are not theme tokens and they render identically in both themes.
 */

import type { LogoBox, Plate } from './logo';
import type { Matrix } from './qr/encode';

export interface Style {
  /** CSS colour of the dark modules. */
  foreground: string;
  /** CSS colour of the plate behind the code, including the quiet zone. */
  background: string;
  /** Modules of blank margin on every side. The standard asks for 4. */
  quietZone: number;
}

export const DEFAULT_STYLE: Style = { foreground: '#000000', background: '#ffffff', quietZone: 4 };

export interface Scene {
  svg: string;
  /** Modules per side including the quiet zone; the viewBox is `0 0 side side`. */
  side: number;
  /** Dark modules drawn. */
  darkModules: number;
}

const COLOUR = /^#[0-9a-f]{6}$/i;

/** Only six-digit hex colours are accepted: they are unambiguous in SVG, PNG and PDF alike. */
export function isColour(value: string): boolean {
  return COLOUR.test(value);
}

/** The five characters XML reserves, escaped so that a title is text and never markup. */
function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/**
 * @param title The image's accessible name — what scanning does, e.g. "QR code that opens
 *   example.com". It becomes the SVG's `<title>`, which is what a screen reader announces on
 *   screen and what the exported file carries.
 */
/** The plate a logo sits on: the box the logo fills, the margin around it, and its colour. */
export interface LogoPlate {
  box: LogoBox;
  plate: Plate;
  /** Modules of plate around the box on every side. */
  padding: number;
  /** A six-digit hex colour, normally the background. */
  colour: string;
}

function plateMarkup(logo: LogoPlate): string {
  if (logo.plate === 'none') return '';
  if (!isColour(logo.colour)) {
    throw new Error('a plate colour has to be a six-digit hex value like #ffffff');
  }
  const pad = logo.padding;
  const x = logo.box.x - pad;
  const y = logo.box.y - pad;
  const w = logo.box.width + 2 * pad;
  const h = logo.box.height + 2 * pad;
  const fill = logo.colour.toLowerCase();
  if (logo.plate === 'circle') {
    const r = Math.max(w, h) / 2;
    return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" fill="${fill}"/>`;
  }
  const rx = logo.plate === 'rounded' ? ` rx="${Math.max(1, Math.round(w / 8))}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx} fill="${fill}"/>`;
}

/**
 * @param logo When a logo will sit on the code: its plate is drawn over the modules, as part of
 *   the same SVG, so that what the gate verifies is what is shown. The logo image itself is not
 *   in the SVG — the host composes it and the screen overlays it.
 */
export function renderScene(
  matrix: Matrix,
  style: Style = DEFAULT_STYLE,
  title = 'QR code',
  logo?: LogoPlate,
): Scene {
  if (!isColour(style.foreground) || !isColour(style.background)) {
    throw new Error('a colour has to be a six-digit hex value like #1a2b3c');
  }
  if (!Number.isInteger(style.quietZone) || style.quietZone < 0 || style.quietZone > 16) {
    throw new Error('the quiet zone has to be a whole number of modules between 0 and 16');
  }
  const q = style.quietZone;
  const side = matrix.size + 2 * q;
  const segments: string[] = [];
  let darkModules = 0;
  for (let y = 0; y < matrix.size; y += 1) {
    const row = matrix.modules[y];
    if (row === undefined) continue;
    for (let x = 0; x < matrix.size; x += 1) {
      if (row[x] === true) {
        segments.push(`M${x + q} ${y + q}h1v1h-1z`);
        darkModules += 1;
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `shape-rendering="crispEdges" role="img">` +
    `<title>${escapeXml(title)}</title>` +
    `<rect width="${side}" height="${side}" fill="${style.background.toLowerCase()}"/>` +
    `<path d="${segments.join('')}" fill="${style.foreground.toLowerCase()}"/>` +
    (logo === undefined ? '' : plateMarkup(logo)) +
    `</svg>`;
  return { svg, side, darkModules };
}
