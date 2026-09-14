/**
 * A place, as a `geo:` URI (RFC 5870): decimal degrees, latitude first, separated by a comma.
 *
 * The comma is the trap. Half the world writes `-23,5505` for a coordinate, and in this format a
 * comma is the separator between latitude and longitude — so a decimal comma does not produce a
 * slightly wrong place, it produces a URI with three numbers in it and a map that opens nowhere.
 * It is refused with a sentence that says which character to use, rather than guessed at.
 *
 * What is emitted is normalised: no leading `+`, at most six decimals — about ten centimetres,
 * far past what any consumer positioning is honest about — and no trailing zeros, so the same
 * place typed two ways produces the same bytes.
 */

import type { PayloadResult } from './index';

export interface GeoForm {
  kind: 'geo';
  latitude: string;
  longitude: string;
}

/** Six decimals of a degree is roughly a tenth of a metre. */
export const GEO_DECIMALS = 6;

const DECIMAL_DEGREES = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

type CoordinateResult = { ok: true; value: number } | { ok: false; reason: string };

function parseCoordinate(input: string, name: 'latitude' | 'longitude'): CoordinateResult {
  const text = input.trim();
  const article = name === 'latitude' ? 'A latitude' : 'A longitude';
  const example = name === 'latitude' ? '-23.5505' : '-46.6333';
  if (text.length === 0) {
    return { ok: false, reason: `Type the ${name} to see its code.` };
  }
  if (text.includes(',')) {
    return {
      ok: false,
      reason: `${article} uses a dot for the decimal, not a comma — write it like ${example}.`,
    };
  }
  if (!DECIMAL_DEGREES.test(text)) {
    return { ok: false, reason: `${article} has to be a number in degrees, like ${example}.` };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `${article} has to be a number in degrees, like ${example}.` };
  }
  const limit = name === 'latitude' ? 90 : 180;
  if (value < -limit || value > limit) {
    return { ok: false, reason: `${article} has to be between -${limit} and ${limit}.` };
  }
  return { ok: true, value };
}

/** Six decimals at most, no trailing zeros, no negative zero. */
export function formatCoordinate(value: number): string {
  const fixed = value.toFixed(GEO_DECIMALS);
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed === '-0' || trimmed.length === 0 ? '0' : trimmed;
}

export function buildGeo(form: GeoForm): PayloadResult {
  const latitude = parseCoordinate(form.latitude, 'latitude');
  if (!latitude.ok) {
    return { ok: false, reason: latitude.reason, field: 'latitude' };
  }
  const longitude = parseCoordinate(form.longitude, 'longitude');
  if (!longitude.ok) {
    return { ok: false, reason: longitude.reason, field: 'longitude' };
  }
  const lat = formatCoordinate(latitude.value);
  const lon = formatCoordinate(longitude.value);
  return { ok: true, payload: `geo:${lat},${lon}`, summary: `Opens the map at ${lat}, ${lon}` };
}
