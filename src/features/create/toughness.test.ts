import { describe, expect, it } from 'vitest';

import { nextPrintWidth, toughnessOptions, type ToughnessRequest } from './toughness';

const MENU = 'https://example.com/menu';
const CAMPAIGN =
  'https://example.com/menu?table=12&utm_source=flyer&utm_medium=print&utm_campaign=summer-2026';

function request(overrides: Partial<ToughnessRequest>): ToughnessRequest {
  return {
    payload: MENU,
    link: MENU,
    logoSize: 'largest',
    quietZone: 4,
    ecl: undefined,
    widthMm: 25,
    ...overrides,
  };
}

describe('making a code tougher', () => {
  it('offers only changes that ask for a larger smudge, toughest first', () => {
    for (const r of [
      request({}),
      request({ logoSize: null }),
      request({ payload: CAMPAIGN, link: CAMPAIGN }),
    ]) {
      const t = toughnessOptions(r);
      expect(t).not.toBeNull();
      if (t === null) return;
      for (const option of t.options) {
        expect(option.smudgeMm ?? 0).toBeGreaterThanOrEqual((t.now.smudgeMm ?? 0) + 0.1);
      }
      const smudges = t.options.map((o) => o.smudgeMm ?? 0);
      expect(smudges).toEqual([...smudges].sort((a, b) => b - a));
    }
  });

  it('measures the code on screen as the card does: the menu with a logo is 4.9 mm at 25 mm', () => {
    const t = toughnessOptions(request({}));
    expect(t?.now).toMatchObject({ version: 3, ecl: 'H' });
    expect(t?.now.smudgeMm?.toFixed(1)).toBe('4.9');
  });

  it('on a link this short every logo size is the same code, so only a larger print is offered', () => {
    const t = toughnessOptions(request({}));
    expect(t?.options.map((o) => o.key)).toEqual(['print']);
    expect(t?.options[0]).toMatchObject({ label: 'Printed 30 mm wide', choice: { widthMm: 30 } });
  });

  it('a link without its tracking parameters is a smaller code, and a tougher one', () => {
    const t = toughnessOptions(request({ payload: CAMPAIGN, link: CAMPAIGN }));
    const tracking = t?.options.find((o) => o.key === 'tracking');
    expect(tracking).toBeDefined();
    expect(tracking?.choice).toEqual({ url: 'https://example.com/menu?table=12' });
    expect(tracking?.label).toBe(
      'Without its tracking parameters (utm_source, utm_medium, utm_campaign)',
    );
    expect(tracking?.version).toBeLessThan(t?.now.version ?? 0);
    expect(tracking?.moduleMm).toBeGreaterThan(t?.now.moduleMm ?? Infinity);
  });

  it('a smaller logo says what the mark gives up', () => {
    const t = toughnessOptions(request({ payload: CAMPAIGN, link: CAMPAIGN }));
    const small = t?.options.find((o) => o.key === 'logo-small');
    expect(small?.cost).toMatch(/^the mark prints \d+\.\d mm wide instead of \d+\.\d mm$/);
    expect(small?.logoMm).toBeLessThan(t?.now.logoMm ?? 0);
  });

  it('without a logo, asks for a higher level once, in the Look card’s words', () => {
    const t = toughnessOptions(request({ logoSize: null }));
    const levels = t?.options.filter((o) => o.key.startsWith('level-')) ?? [];
    // At least Q already plans level H for this link, so H would be the same code: one row.
    expect(levels.map((o) => o.label)).toEqual(['At least Q']);
    expect(levels[0]?.cost).toMatch(/^a denser code: modules 0\.\d\d mm instead of 0\.\d\d mm$/);
  });

  it('a level already asked for is not offered again', () => {
    const t = toughnessOptions(request({ logoSize: null, ecl: 'H' }));
    expect(t?.options.some((o) => o.key.startsWith('level-'))).toBe(false);
  });

  it('offers no tracking row for a code that is not a link, or a link without them', () => {
    expect(toughnessOptions(request({}))?.options.some((o) => o.key === 'tracking')).toBe(false);
    expect(
      toughnessOptions(request({ payload: 'Lote 42', link: null, logoSize: null }))?.options.some(
        (o) => o.key === 'tracking',
      ),
    ).toBe(false);
  });

  it('steps the print through the proof sheet sizes and stops at the last', () => {
    expect(nextPrintWidth(25)).toBe(30);
    expect(nextPrintWidth(25.04)).toBe(30);
    expect(nextPrintWidth(27)).toBe(30);
    expect(nextPrintWidth(200)).toBeNull();
  });
});

describe('the rows in words', () => {
  it('says what the code is now and what each change makes it', async () => {
    const { nowLine, optionLine } = await import('./toughness');
    const t = toughnessOptions(request({}));
    if (t === null) throw new Error('no plan');
    expect(nowLine(t.now)).toBe('Now: version 3, level H — a smudge 4.9 mm across can stop it.');
    expect(optionLine(t.options[0] as NonNullable<(typeof t.options)[0]>)).toBe(
      'Version 3, level H — a smudge 5.9 mm across can stop it; 5 mm more paper each way.',
    );
  });
});
