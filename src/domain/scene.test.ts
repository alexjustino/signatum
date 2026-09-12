import { describe, expect, it } from 'vitest';

import { encodeText } from './qr/encode';
import { centredBox } from './placement';
import { DEFAULT_STYLE, isColour, renderScene } from './scene';

describe('renderScene', () => {
  const matrix = encodeText('https://example.com/', 'M');

  it('is one self-contained SVG with a quiet zone of four modules', () => {
    const scene = renderScene(matrix);
    expect(scene.side).toBe(matrix.size + 8);
    expect(scene.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(scene.svg).toContain(`viewBox="0 0 ${scene.side} ${scene.side}"`);
    expect(scene.svg).toContain(
      `<rect width="${scene.side}" height="${scene.side}" fill="#ffffff"/>`,
    );
    expect(scene.svg.endsWith('</svg>')).toBe(true);
  });

  it('draws exactly the dark modules, and nothing else', () => {
    const scene = renderScene(matrix);
    const dark = matrix.modules.flat().filter(Boolean).length;
    expect(scene.darkModules).toBe(dark);
    expect((scene.svg.match(/h1v1h-1z/g) ?? []).length).toBe(dark);
    // The top-left finder's first module lands at (quietZone, quietZone).
    expect(scene.svg).toContain('M4 4h1v1h-1z');
  });

  it('carries no script, no external reference and no image', () => {
    const svg = renderScene(matrix).svg;
    for (const forbidden of ['<script', 'href', '<image', '<foreignObject', '<!ENTITY', 'url(']) {
      expect(svg).not.toContain(forbidden);
    }
  });

  it('uses the print colours as given, never a theme token', () => {
    const scene = renderScene(matrix, {
      foreground: '#1A2B3C',
      background: '#FAFAFA',
      quietZone: 2,
    });
    expect(scene.svg).toContain('fill="#fafafa"');
    expect(scene.svg).toContain('fill="#1a2b3c"');
    expect(scene.side).toBe(matrix.size + 4);
  });

  it('refuses a colour that is not six-digit hex, and a quiet zone that is not whole', () => {
    expect(() => renderScene(matrix, { ...DEFAULT_STYLE, foreground: 'black' })).toThrow();
    expect(() => renderScene(matrix, { ...DEFAULT_STYLE, background: '#fff' })).toThrow();
    expect(() => renderScene(matrix, { ...DEFAULT_STYLE, quietZone: 1.5 })).toThrow();
    expect(() => renderScene(matrix, { ...DEFAULT_STYLE, quietZone: -1 })).toThrow();
  });

  it('carries its accessible name as a title, escaped', () => {
    expect(renderScene(matrix).svg).toContain('<title>QR code</title>');
    const named = renderScene(matrix, DEFAULT_STYLE, 'QR code that opens a<b>&"c\'.example');
    expect(named.svg).toContain(
      '<title>QR code that opens a&lt;b&gt;&amp;&quot;c&apos;.example</title>',
    );
    expect(named.svg).not.toContain('<b>');
  });

  it('knows a colour when it sees one', () => {
    expect(isColour('#000000')).toBe(true);
    expect(isColour('#ABCDEF')).toBe(true);
    expect(isColour('#abc')).toBe(false);
    expect(isColour('rgb(0,0,0)')).toBe(false);
  });
});

describe('the logo plate', () => {
  const matrix = encodeText('https://example.com/', 'H');
  const box = centredBox(matrix.version, 9, 4);

  it('is drawn over the modules, as part of the same SVG', () => {
    const svg = renderScene(matrix, DEFAULT_STYLE, 'QR code', {
      box,
      plate: 'square',
      padding: 1,
      colour: '#ffffff',
    }).svg;
    const path = svg.indexOf('<path');
    const plate = svg.indexOf(`<rect x="${box.x - 1}" y="${box.y - 1}"`);
    expect(plate).toBeGreaterThan(path);
    expect(svg).toContain(`width="${box.width + 2}" height="${box.height + 2}" fill="#ffffff"/>`);
  });

  it('rounds and circles when asked, and draws nothing for none', () => {
    const rounded = renderScene(matrix, DEFAULT_STYLE, 'QR code', {
      box,
      plate: 'rounded',
      padding: 1,
      colour: '#ffffff',
    }).svg;
    expect(rounded).toMatch(
      /<rect x="\d+" y="\d+" width="\d+" height="\d+" rx="\d+" fill="#ffffff"\/>/,
    );
    const circle = renderScene(matrix, DEFAULT_STYLE, 'QR code', {
      box,
      plate: 'circle',
      padding: 0,
      colour: '#ffffff',
    }).svg;
    expect(circle).toContain('<circle cx=');
    const none = renderScene(matrix, DEFAULT_STYLE, 'QR code', {
      box,
      plate: 'none',
      padding: 1,
      colour: '#ffffff',
    }).svg;
    expect(none).toBe(renderScene(matrix).svg);
  });

  it('refuses a plate colour that is not one', () => {
    expect(() =>
      renderScene(matrix, DEFAULT_STYLE, 'QR code', {
        box,
        plate: 'square',
        padding: 1,
        colour: 'white',
      }),
    ).toThrow();
  });
});
