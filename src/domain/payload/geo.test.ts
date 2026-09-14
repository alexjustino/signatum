import { describe, expect, it } from 'vitest';

import { buildGeo, formatCoordinate } from './geo';

describe('buildGeo', () => {
  it('writes a geo URI and names the place it opens', () => {
    expect(buildGeo({ kind: 'geo', latitude: '-23.5505', longitude: '-46.6333' })).toEqual({
      ok: true,
      payload: 'geo:-23.5505,-46.6333',
      summary: 'Opens the map at -23.5505, -46.6333',
    });
  });

  it('normalises to six decimals, with no trailing zeros and no plus', () => {
    expect(buildGeo({ kind: 'geo', latitude: '+48.858400', longitude: '2.294500' })).toMatchObject({
      payload: 'geo:48.8584,2.2945',
    });
    expect(buildGeo({ kind: 'geo', latitude: ' -23.55052049 ', longitude: '0' })).toMatchObject({
      payload: 'geo:-23.55052,0',
    });
    expect(buildGeo({ kind: 'geo', latitude: '10.0', longitude: '-0.0000001' })).toMatchObject({
      payload: 'geo:10,0',
    });
  });

  it('formats a coordinate the same way wherever it is read', () => {
    expect(formatCoordinate(-0)).toBe('0');
    expect(formatCoordinate(-23.55052)).toBe('-23.55052');
    expect(formatCoordinate(90)).toBe('90');
    expect(formatCoordinate(-179.9999994)).toBe('-179.999999');
  });

  it('accepts the poles and the antimeridian and refuses a step past them', () => {
    expect(buildGeo({ kind: 'geo', latitude: '-90', longitude: '180' })).toMatchObject({
      payload: 'geo:-90,180',
    });
    expect(buildGeo({ kind: 'geo', latitude: '90.000001', longitude: '0' })).toEqual({
      ok: false,
      reason: 'A latitude has to be between -90 and 90.',
      field: 'latitude',
    });
    expect(buildGeo({ kind: 'geo', latitude: '0', longitude: '-180.000001' })).toEqual({
      ok: false,
      reason: 'A longitude has to be between -180 and 180.',
      field: 'longitude',
    });
  });

  it('refuses a decimal comma, because here a comma separates the two numbers', () => {
    expect(buildGeo({ kind: 'geo', latitude: '-23,5', longitude: '-46.6333' })).toEqual({
      ok: false,
      reason: 'A latitude uses a dot for the decimal, not a comma — write it like -23.5505.',
      field: 'latitude',
    });
    expect(buildGeo({ kind: 'geo', latitude: '-23.5505', longitude: '-46,6333' })).toEqual({
      ok: false,
      reason: 'A longitude uses a dot for the decimal, not a comma — write it like -46.6333.',
      field: 'longitude',
    });
    expect(buildGeo({ kind: 'geo', latitude: '-23.5505,-46.6333', longitude: '0' })).toMatchObject({
      ok: false,
      field: 'latitude',
    });
  });

  it.each([
    ['', 'Type the latitude to see its code.'],
    ['   ', 'Type the latitude to see its code.'],
    ['north', 'A latitude has to be a number in degrees, like -23.5505.'],
    ['1.2.3', 'A latitude has to be a number in degrees, like -23.5505.'],
    ['1e2', 'A latitude has to be a number in degrees, like -23.5505.'],
    ['23°33', 'A latitude has to be a number in degrees, like -23.5505.'],
    ['- 23.5', 'A latitude has to be a number in degrees, like -23.5505.'],
  ])('refuses the latitude %j with a sentence', (latitude, reason) => {
    expect(buildGeo({ kind: 'geo', latitude, longitude: '0' })).toEqual({
      ok: false,
      reason,
      field: 'latitude',
    });
  });

  it('refuses an empty longitude once the latitude is good', () => {
    expect(buildGeo({ kind: 'geo', latitude: '0', longitude: '' })).toEqual({
      ok: false,
      reason: 'Type the longitude to see its code.',
      field: 'longitude',
    });
  });
});
