import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import type { LogoBox } from './logo';
import { planCode, plateOf } from './placement';
import { encode, type Matrix } from './qr/encode';
import { blockBudgets, headroom, predictDamage, weakestSpot, type Damage } from './resilience';

const QUIET = 4;

/** A seeded generator, so a failure names a case that can be run again. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rasterise the code as the product draws it — the plate bare paper — then apply the damage on
 * top, as a scratch or a blot lands on a print, and ask jsQR.
 */
function decodeDamaged(
  m: Matrix,
  plate: LogoBox | null,
  damage: readonly Damage[],
  scale = 4,
): string | null {
  const n = m.size + 2 * QUIET;
  const ink: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  for (let y = 0; y < m.size; y += 1) {
    for (let x = 0; x < m.size; x += 1) {
      const sx = x + QUIET;
      const sy = y + QUIET;
      const covered =
        plate !== null &&
        sx >= plate.x &&
        sx < plate.x + plate.width &&
        sy >= plate.y &&
        sy < plate.y + plate.height;
      const row = ink[sy];
      if (row !== undefined) row[sx] = !covered && m.modules[y]?.[x] === true;
    }
  }
  for (const d of damage) {
    const row = ink[d.y + QUIET];
    if (row !== undefined && d.x + QUIET >= 0 && d.x + QUIET < n) row[d.x + QUIET] = d.dark;
  }
  const side = n * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let sy = 0; sy < n; sy += 1) {
    for (let sx = 0; sx < n; sx += 1) {
      if (ink[sy]?.[sx] !== true) continue;
      for (let py = 0; py < scale; py += 1) {
        for (let px = 0; px < scale; px += 1) {
          const i = ((sy * scale + py) * side + sx * scale + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Every module in the cells turned to its opposite: the worst a smudge can do there. */
function inverted(m: Matrix, cells: readonly { x: number; y: number }[]): Damage[] {
  return cells.map(({ x, y }) => ({ x, y, dark: m.modules[y]?.[x] !== true }));
}

/** A disk of modules around a module centre, clipped to the symbol. */
function disk(m: Matrix, cx: number, cy: number, radius: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const r = Math.ceil(radius);
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      if (Math.hypot(x - cx, y - cy) <= radius) cells.push({ x, y });
    }
  }
  return cells;
}

interface Case {
  name: string;
  text: string;
  matrix: Matrix;
  plate: LogoBox | null;
}

function withLogo(text: string): Case {
  const plan = planCode(text, { logo: true, quietZone: QUIET });
  if (!plan.ok || plan.box === null) throw new Error(`no plan for ${text}`);
  return { name: `${text} with a logo`, text, matrix: plan.matrix, plate: plateOf(plan.box, 1) };
}

function plain(text: string, ecl: 'L' | 'M' | 'Q' | 'H'): Case {
  return {
    name: `${text} at ${ecl}`,
    text,
    matrix: encode(text, { ecl, boostEcl: false }),
    plate: null,
  };
}

const CASES: Case[] = [
  withLogo('https://example.com/menu'),
  withLogo('https://example.com/a/rather/longer/path/to/a/page?with=a&query=string'),
  plain('https://example.com/menu', 'M'),
  plain('https://example.com/menu', 'L'),
  plain('WIFI:T:WPA;S:Office-5G;P:correct horse battery staple;;', 'Q'),
  plain('A longer text that pushes the symbol to a version with several blocks per level.', 'H'),
];

describe('block budgets', () => {
  it('gives every block its full capacity when there is no logo', () => {
    const m = encode('https://example.com/menu', { ecl: 'M', boostEcl: false });
    const blocks = blockBudgets(m, null, QUIET);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.logo).toBe(0);
      expect(b.spare).toBe(b.capacity);
    }
  });

  it('charges the logo to the blocks it sits on, and never past the safety the engine kept', () => {
    const c = withLogo('https://example.com/menu');
    const blocks = blockBudgets(c.matrix, c.plate, QUIET);
    expect(blocks.some((b) => b.logo > 0)).toBe(true);
    for (const b of blocks) expect(b.spare).toBeGreaterThan(0);
  });
});

describe('predicting damage', () => {
  const m = encode('https://example.com/menu', { ecl: 'M', boostEcl: false });

  it('is guaranteed with no damage at all', () => {
    expect(predictDamage(m, null, QUIET, []).verdict).toBe('guaranteed');
  });

  it('does not count ink on a dark module, or paper on a light one', () => {
    const same: Damage[] = [];
    for (let y = 9; y < 15; y += 1) {
      for (let x = 9; x < 15; x += 1) same.push({ x, y, dark: m.modules[y]?.[x] === true });
    }
    const p = predictDamage(m, null, QUIET, same);
    expect(p.blocks.every((b) => b.damage === 0)).toBe(true);
    expect(p.verdict).toBe('guaranteed');
  });

  it('leaves a finder to the decoder, and says so', () => {
    const p = predictDamage(m, null, QUIET, inverted(m, [{ x: 3, y: 3 }]));
    expect(p.structural).toBe(1);
    expect(p.verdict).toBe('decoder-decides');
  });

  it('leaves the quiet zone to the decoder too', () => {
    const p = predictDamage(m, null, QUIET, [{ x: -1, y: 10, dark: true }]);
    expect(p.quietZone).toBe(1);
    expect(p.verdict).toBe('decoder-decides');
  });

  it('does not charge damage under the plate twice', () => {
    const c = withLogo('https://example.com/menu');
    const plate = c.plate as LogoBox;
    const under: { x: number; y: number }[] = [];
    for (let y = plate.y; y < plate.y + plate.height; y += 1) {
      for (let x = plate.x; x < plate.x + plate.width; x += 1) {
        under.push({ x: x - QUIET, y: y - QUIET });
      }
    }
    const p = predictDamage(c.matrix, c.plate, QUIET, inverted(c.matrix, under));
    expect(p.blocks.every((b) => b.damage === 0)).toBe(true);
  });
});

describe('the arithmetic agrees with an independent decoder', () => {
  it.each(CASES)('$name: whatever it guarantees, jsQR reads', ({ text, matrix, plate }) => {
    expect(decodeDamaged(matrix, plate, [])).toBe(text);
    const random = mulberry32(0x5167 + text.length);
    let guaranteed = 0;
    let past = 0;
    for (let trial = 0; trial < 120; trial += 1) {
      const damage: Damage[] = [];
      const blots = 1 + Math.floor(random() * 3);
      for (let k = 0; k < blots; k += 1) {
        const cx = Math.floor(random() * matrix.size);
        const cy = Math.floor(random() * matrix.size);
        // Up to a sixth of the side: small enough to be survived, large enough not to be.
        const radius = random() * (matrix.size / 6);
        const dark = random() < 0.5;
        for (const cell of disk(matrix, cx, cy, radius)) damage.push({ ...cell, dark });
      }
      const p = predictDamage(matrix, plate, QUIET, damage);
      if (p.verdict === 'guaranteed') {
        guaranteed += 1;
        expect(decodeDamaged(matrix, plate, damage), `trial ${trial}`).toBe(text);
      } else if (p.verdict === 'past-guarantee') {
        past += 1;
      }
    }
    // The sample exercises both sides of the line, or it proves nothing.
    expect(guaranteed).toBeGreaterThan(10);
    expect(past).toBeGreaterThan(0);
  });
});

describe('the weakest spot', () => {
  it.each(CASES)('$name: inverted, it stops the code; one step smaller, it does not', (c) => {
    const spot = weakestSpot(c.matrix, c.plate, QUIET);
    expect(spot).not.toBeNull();
    if (spot === null) return;

    const worst = inverted(c.matrix, spot.cells);
    expect(predictDamage(c.matrix, c.plate, QUIET, worst).verdict).not.toBe('guaranteed');
    expect(decodeDamaged(c.matrix, c.plate, worst)).not.toBe(c.text);

    // Every disk strictly smaller, anywhere on the data, stays within the guarantee — the spot is
    // the minimum. Checked here at its own centre, where it matters most.
    const smaller = disk(c.matrix, spot.x, spot.y, spot.radius - 0.01).filter(
      ({ x, y }) => !(x === spot.x && y === spot.y && spot.radius === 0),
    );
    const p = predictDamage(c.matrix, c.plate, QUIET, inverted(c.matrix, smaller));
    expect(p.blocks.every((b) => b.spare >= 0)).toBe(true);
  });

  it('is the same every time it is asked', () => {
    const c = withLogo('https://example.com/menu');
    expect(weakestSpot(c.matrix, c.plate, QUIET)).toEqual(weakestSpot(c.matrix, c.plate, QUIET));
  });

  it('is smaller with a logo than without one, on the same text', () => {
    const text = 'https://example.com/menu';
    const logo = withLogo(text);
    const bare = encode(text, {
      ecl: logo.matrix.ecl,
      minVersion: logo.matrix.version,
      boostEcl: false,
    });
    const a = weakestSpot(logo.matrix, logo.plate, QUIET);
    const b = weakestSpot(bare, null, QUIET);
    expect(a?.radius).toBeLessThan(b?.radius ?? 0);
  });
});

describe('headroom', () => {
  it('puts the textbook figure where the levels say, and the logo below it', () => {
    const text = 'https://example.com/menu';
    const shares = (['L', 'M', 'Q', 'H'] as const).map(
      (ecl) =>
        headroom(encode(text, { ecl, minVersion: 5, boostEcl: false }), null, QUIET).textbook,
    );
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i]).toBeGreaterThan(shares[i - 1] ?? 0);
    }
    expect(shares[3]).toBeGreaterThan(0.25);
    expect(shares[3]).toBeLessThan(0.36);

    const c = withLogo(text);
    const h = headroom(c.matrix, c.plate, QUIET);
    expect(h.afterLogo).toBeLessThan(h.textbook);
    // The point of the whole module: the weakest spot is a far smaller share than "30 %".
    expect(h.weakestShare).toBeLessThan(h.textbook / 2);
  });
});
