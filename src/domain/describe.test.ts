import { describe, expect, it } from 'vitest';

import { describeCode, describeGate, describePlan, describeVariant, gateState } from './describe';
import { planCode, type Plan } from './placement';

const verified = { verified: true, reason: null, decoder: 'rqrr 0.9.0' };
const refused = { verified: false, reason: 'The decoder found no code.', decoder: 'rqrr 0.9.0' };

describe('describeCode', () => {
  it('is the accessible name of the preview, from the payload summary', () => {
    expect(describeCode('Opens example.com')).toBe('QR code that opens example.com');
    expect(describeCode('Joins Office-5G')).toBe('QR code that joins Office-5G');
  });
});

describe('gateState', () => {
  it('is pending while a check runs, whatever the last report said', () => {
    expect(gateState(null, false)).toBe('pending');
    expect(gateState(null, true)).toBe('pending');
    expect(gateState(verified, true)).toBe('pending');
  });

  it('is decided by the report once the check is over', () => {
    expect(gateState(verified, false)).toBe('verified');
    expect(gateState(refused, false)).toBe('refused');
  });
});

describe('describeGate', () => {
  it('says what is happening, in one sentence', () => {
    expect(describeGate(null, true)).toBe('Checking that the code scans…');
    expect(describeGate(null, false)).toBe('Not verified yet.');
    expect(describeGate(verified, false)).toBe('Verified — rqrr 0.9.0 read it back byte for byte.');
    expect(describeGate(refused, false)).toBe('The decoder found no code.');
  });
});

describe('describePlan', () => {
  /** A plan is what the engine returns; only the numbers this sentence reads matter here. */
  const planned = (over: Partial<Extract<Plan, { ok: true }>>): Plan => ({
    ok: true,
    matrix: { size: 53, version: 9, ecl: 'H', mask: 3, modules: [] },
    ecl: 'H',
    version: 9,
    mask: 3,
    box: { x: 22, y: 22, width: 13, height: 13 },
    coverage: { perBlock: [4, 3], worst: 4, budget: 7, touchesFunction: false },
    ...over,
  });

  it('says the level, the version, the mask and what the logo costs', () => {
    expect(describePlan(planned({}))).toBe(
      'Level H, version 9, mask 3 — the logo uses 4 of 7 codewords a block can spare.',
    );
  });

  it('has nothing to say about a code with no logo on it', () => {
    expect(describePlan(planned({ box: null, coverage: null }))).toBeNull();
  });

  it('has nothing to say about a refusal — the refusal is its own sentence', () => {
    expect(describePlan({ ok: false, reason: 'It does not fit.' })).toBeNull();
  });

  it('reads a real plan, whatever the engine chose', () => {
    const plan = planCode('https://example.com/menu', { logo: true, quietZone: 4, padding: 1 });
    expect(plan.ok).toBe(true);
    expect(describePlan(plan)).toMatch(
      /^Level [HQ], version \d+, mask [0-7] — the logo uses \d+ of \d+ codewords a block can spare\.$/,
    );
  });
});

describe('describeVariant', () => {
  it('says what was done to the code and whether it still reads', () => {
    expect(describeVariant({ label: 'Shrunk to 25 %', verified: true })).toBe(
      'Shrunk to 25 % — reads',
    );
    expect(describeVariant({ label: 'Blurred 3 px', verified: false })).toBe(
      'Blurred 3 px — fails',
    );
    expect(describeVariant({ label: 'JPEG quality 50', verified: true })).toBe(
      'JPEG quality 50 — reads',
    );
  });

  it('carries the verdict in the word, never in a mark beside it', () => {
    // The icon in the list is decorative; a line read aloud has to hold the answer on its own.
    for (const label of ['Shrunk to 50 %', 'Blurred 1 px']) {
      expect(describeVariant({ label, verified: true })).toMatch(/ — reads$/);
      expect(describeVariant({ label, verified: false })).toMatch(/ — fails$/);
    }
  });
});
