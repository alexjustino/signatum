import { describe, expect, it } from 'vitest';

import { describeCode, describeGate, gateState } from './describe';

const verified = { verified: true, reason: null, decoder: 'rqrr 0.9.0' };
const refused = { verified: false, reason: 'The decoder found no code.', decoder: 'rqrr 0.9.0' };

describe('describeCode', () => {
  it('is the accessible name of the preview', () => {
    expect(describeCode('https://example.com/menu')).toBe('QR code that opens example.com');
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
