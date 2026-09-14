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
import { functionModules } from './placement';
import type { Matrix } from './qr/encode';
import type { FinderShape, ModuleShape } from './style';

export interface Style {
  /** CSS colour of the dark modules. */
  foreground: string;
  /** CSS colour of the plate behind the code, including the quiet zone. */
  background: string;
  /** Modules of blank margin on every side. The standard asks for 4. */
  quietZone: number;
  /** How a data module is drawn. Square unless asked otherwise. */
  moduleShape?: ModuleShape;
  /** How the three finder patterns are drawn. Square unless asked otherwise. */
  finderShape?: FinderShape;
}

export const DEFAULT_STYLE: Style = {
  foreground: '#000000',
  background: '#ffffff',
  quietZone: 4,
  moduleShape: 'square',
  finderShape: 'square',
};

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
  const n = matrix.size;
  const side = n + 2 * q;
  const moduleShape = style.moduleShape ?? 'square';
  const finderShape = style.finderShape ?? 'square';
  const shaped = moduleShape !== 'square' || finderShape !== 'square';
  const fg = style.foreground.toLowerCase();
  const bg = style.background.toLowerCase();

  // When every shape is square the finders are just modules, and the output is the one the
  // product has written since its first slice. Otherwise the three finders are drawn on their
  // own, in their shape, and the loop below skips their modules.
  const isFinder = (x: number, y: number): boolean =>
    shaped && ((x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7));
  // The timing, alignment and format modules stay square whatever the data modules are: a
  // decoder finds the grid by their runs, and a row of dots is not a run.
  const keepSquare = shaped ? functionModules(matrix.version) : null;

  const segments: string[] = [];
  let darkModules = 0;
  for (let y = 0; y < n; y += 1) {
    const row = matrix.modules[y];
    if (row === undefined) continue;
    for (let x = 0; x < n; x += 1) {
      if (row[x] !== true) continue;
      darkModules += 1;
      if (isFinder(x, y)) continue;
      const shape = keepSquare?.[y]?.[x] === true ? 'square' : moduleShape;
      segments.push(moduleMarkup(shape, x + q, y + q));
    }
  }
  const finders = shaped
    ? [
        [q, q],
        [q + n - 7, q],
        [q, q + n - 7],
      ]
        .map(([x, y]) => finderMarkup(finderShape, x ?? 0, y ?? 0, fg, bg))
        .join('')
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `shape-rendering="${shaped ? 'geometricPrecision' : 'crispEdges'}" role="img">` +
    `<title>${escapeXml(title)}</title>` +
    `<rect width="${side}" height="${side}" fill="${bg}"/>` +
    `<path d="${segments.join('')}" fill="${fg}"/>` +
    finders +
    (logo === undefined ? '' : plateMarkup(logo)) +
    `</svg>`;
  return { svg, side, darkModules };
}

/** Corner radius of a rounded module, and radius of a dot, in modules. */
const ROUNDED_MODULE = 0.28;
const DOT_MODULE = 0.42;

/** One dark module as a path segment, in its shape. */
function moduleMarkup(shape: ModuleShape, x: number, y: number): string {
  switch (shape) {
    case 'square':
      return `M${x} ${y}h1v1h-1z`;
    case 'rounded': {
      const r = ROUNDED_MODULE;
      const w = 1 - 2 * r;
      return (
        `M${x + r} ${y}h${w}a${r} ${r} 0 0 1 ${r} ${r}v${w}a${r} ${r} 0 0 1 -${r} ${r}` +
        `h-${w}a${r} ${r} 0 0 1 -${r} -${r}v-${w}a${r} ${r} 0 0 1 ${r} -${r}z`
      );
    }
    case 'dot': {
      const r = DOT_MODULE;
      const cx = x + 0.5;
      const cy = y + 0.5;
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;
    }
  }
}

/** Corner radii of a rounded finder: the 7×7 ring, the 5×5 gap and the 3×3 heart, in modules. */
const ROUNDED_FINDER = [0.75, 0.5, 0.3] as const;

/**
 * One finder pattern — the 7×7 ring and the 3×3 heart — drawn as three opaque shapes: the
 * outer in the code colour, the 5×5 gap in the plate colour, the heart in the code colour.
 *
 * Only square and rounded exist, and the rounding is modest on purpose: the host's decoder
 * derives the grid from the finder's corners, and measured against it a ring rounded past a
 * radius of one module — or a circle — is not read at any size. A shape the gate would never
 * let out is not offered.
 */
function finderMarkup(shape: FinderShape, x: number, y: number, fg: string, bg: string): string {
  const rx = shape === 'rounded' ? ROUNDED_FINDER : ([0, 0, 0] as const);
  const ring = (ox: number, size: number, r: number, fill: string) =>
    `<rect x="${x + ox}" y="${y + ox}" width="${size}" height="${size}"` +
    (r > 0 ? ` rx="${r}"` : '') +
    ` fill="${fill}"/>`;
  return ring(0, 7, rx[0], fg) + ring(1, 5, rx[1], bg) + ring(2, 3, rx[2], fg);
}
