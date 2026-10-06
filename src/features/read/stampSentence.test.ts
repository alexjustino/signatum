import { describe, expect, it } from 'vitest';

import type { StampCheck } from '@/data/read';

import { stampDay, stampSentence } from './stampSentence';

/** Midday UTC, so the day is the same in every time zone this suite is likely to run in. */
const VERIFIED_AT = '2026-09-14T12:00:00.000Z';

const BASE: StampCheck = {
  stamped: true,
  intact: true,
  kind: 'png',
  decoder: 'rqrr 0.10.1',
  inWorkspace: true,
  matchesRecord: true,
  verifiedAt: VERIFIED_AT,
  format: 'png',
  dpi: 300,
  codeId: null,
  codeName: null,
};

describe('stampDay', () => {
  it('writes the day as 14 Sep 2026, whatever the runtime spells the month', () => {
    expect(stampDay(VERIFIED_AT)).toBe('14 Sep 2026');
  });

  it('says nothing about a text that is not a date', () => {
    expect(stampDay('yesterday')).toBeNull();
  });
});

describe('stampSentence', () => {
  it('a file this workspace verified, unchanged', () => {
    expect(stampSentence(BASE)).toEqual({
      severity: 'success',
      sentence: 'Verified by this workspace on 14 Sep 2026, by rqrr 0.10.1 — unchanged since.',
      detail: null,
    });
  });

  it('a stamp from another workspace, unchanged', () => {
    const said = stampSentence({
      ...BASE,
      inWorkspace: false,
      matchesRecord: false,
      verifiedAt: null,
      format: null,
      dpi: null,
    });
    expect(said.severity).toBe('info');
    expect(said.sentence).toBe(
      'Carries a Signatum stamp from another workspace: read back by rqrr 0.10.1, and unchanged since. When and where it was verified is known only to the workspace that made it.',
    );
  });

  it('a stamp this workspace issued for a different file', () => {
    const said = stampSentence({ ...BASE, matchesRecord: false, verifiedAt: null });
    expect(said).toEqual({
      severity: 'caution',
      sentence: 'This workspace verified a different file under this stamp.',
      detail: null,
    });
  });

  it('a changed file is said to be changed before anything about the workspace', () => {
    for (const record of [true, false]) {
      const said = stampSentence({ ...BASE, intact: false, matchesRecord: record });
      expect(said).toEqual({
        severity: 'caution',
        sentence: 'Carries a Signatum stamp, but the file was changed after it was verified.',
        detail: null,
      });
    }
  });

  it('a file with no stamp', () => {
    expect(
      stampSentence({
        ...BASE,
        stamped: false,
        intact: false,
        decoder: null,
        inWorkspace: false,
        matchesRecord: false,
        verifiedAt: null,
      }),
    ).toEqual({
      severity: 'info',
      sentence: 'This file carries no Signatum stamp.',
      detail: 'Files exported by Signatum 1.1 or later carry one, unless stamping was turned off.',
    });
  });

  it('never invents a day the workspace did not give', () => {
    expect(stampSentence({ ...BASE, verifiedAt: 'not a date' }).sentence).toBe(
      'Verified by this workspace, by rqrr 0.10.1 — unchanged since.',
    );
  });
});
