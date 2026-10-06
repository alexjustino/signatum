import { describe, expect, it } from 'vitest';

import { formatDay } from './day';

describe('formatDay', () => {
  it('writes the day, the short month and the year, never a numeric date', () => {
    expect(formatDay('2026-09-14T12:00:00')).toBe('14 Sep 2026');
    expect(formatDay('2026-10-05T08:30:00')).toBe('5 Oct 2026');
  });

  it('says nothing about a text that is not a date', () => {
    expect(formatDay('not a date')).toBeNull();
  });
});
