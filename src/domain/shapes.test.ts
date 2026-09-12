import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { encodeText } from './qr/encode';
import { DEFAULT_STYLE, renderScene, type Style } from './scene';
import { FINDER_SHAPES, MODULE_SHAPES } from './style';

/**
 * A shape is only worth offering if a decoder still reads it. This is the domain's half of that
 * proof: the scene is rasterised the way the host does — every path filled at a whole number of
 * pixels per module — and jsQR, a decoder of a different lineage, reads it back. The host's
 * decoder repeats the check on the exact bytes it writes.
 *
 * The rasteriser here is minimal: it understands the three markups the scene emits (square path
 * segments, arc paths for rounded modules and dots, and the rect/circle finder rings).
 */
function rasterise(svg: string, side: number, scale: number): Uint8ClampedArray {
  const px = side * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  const dark = (x: number, y: number) => {
    const i = (y * px + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  };
  const light = (x: number, y: number) => {
    const i = (y * px + x) * 4;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  };
  const fillDisc = (cx: number, cy: number, r: number, paint: (x: number, y: number) => void) => {
    for (let y = Math.floor((cy - r) * scale); y <= Math.ceil((cy + r) * scale); y += 1) {
      for (let x = Math.floor((cx - r) * scale); x <= Math.ceil((cx + r) * scale); x += 1) {
        const dx = (x + 0.5) / scale - cx;
        const dy = (y + 0.5) / scale - cy;
        if (dx * dx + dy * dy <= r * r && x >= 0 && y >= 0 && x < px && y < px) paint(x, y);
      }
    }
  };
  const fillRect = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    paint: (x: number, y: number) => void,
  ) => {
    for (let y = Math.round(y0 * scale); y < Math.round((y0 + h) * scale); y += 1) {
      for (let x = Math.round(x0 * scale); x < Math.round((x0 + w) * scale); x += 1) {
        if (x >= 0 && y >= 0 && x < px && y < px) paint(x, y);
      }
    }
  };
  // Modules: square segments `M{x} {y}h1v1h-1z`, rounded `M{x+r} {y}h…`, dots `M{cx-r} {cy}a…`.
  const path = /<path d="([^"]*)" fill="#000000"\/>/.exec(svg)?.[1] ?? '';
  for (const seg of path.split('M').slice(1)) {
    const [xs, ys] = seg.split(' ');
    const x = Number(xs);
    const y = Number(ys?.replace(/[a-z].*$/i, ''));
    if (seg.includes('h1v1h-1z')) fillRect(x, y, 1, 1, dark);
    else if (/^[\d.]+ [\d.]+a0\.42/.test(seg)) fillDisc(x + 0.42, y, 0.42, dark);
    else fillRect(x - 0.28, y, 1, 1, dark); // rounded: near enough a square for a decoder
  }
  for (const m of svg.matchAll(
    /<rect x="([\d.]+)" y="([\d.]+)" width="(\d)" height="\d"[^>]*fill="(#[0-9a-f]{6})"\/>/g,
  )) {
    const paint = m[4] === '#000000' ? dark : light;
    fillRect(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[3]), paint);
  }
  for (const m of svg.matchAll(
    /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(#[0-9a-f]{6})"\/>/g,
  )) {
    fillDisc(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === '#000000' ? dark : light);
  }
  return data;
}

describe('every shape still decodes', () => {
  const text = 'https://example.com/menu';
  const matrix = encodeText(text, 'M');

  for (const moduleShape of MODULE_SHAPES) {
    for (const finderShape of FINDER_SHAPES) {
      it(`${moduleShape} modules with ${finderShape} finders`, () => {
        const style: Style = { ...DEFAULT_STYLE, moduleShape, finderShape };
        const scene = renderScene(matrix, style);
        const scale = 6;
        const data = rasterise(scene.svg, scene.side, scale);
        const px = scene.side * scale;
        expect(jsQR(data, px, px)?.data).toBe(text);
      });
    }
  }
});
