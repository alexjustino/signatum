import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  applyKit,
  checkName,
  defaultName,
  describeRecheck,
  recheckTone,
  recheckVerdict,
  redactForSave,
  reopens,
  savedWithoutPassword,
  sceneHash,
  summariseRecheck,
  type RecheckOutcome,
} from './library';
import { emptyForm, type PayloadForm } from './payload';
import { encodeText } from './qr/encode';
import { DEFAULT_STYLE, renderScene } from './scene';
import { DEFAULT_PRINT_SIZE } from './size';

describe('defaultName', () => {
  it('names a code by what it is about', () => {
    expect(defaultName({ kind: 'link', url: 'https://example.com/menu' })).toBe('example.com');
    expect(defaultName({ kind: 'text', text: '  Table 12  — ask   for Ana, please, thanks' })).toBe(
      'Table 12 — ask for Ana,…',
    );
    expect(defaultName({ kind: 'email', to: 'ana@example.com', subject: '', body: '' })).toBe(
      'ana@example.com',
    );
    expect(defaultName({ kind: 'phone', number: '+55 11 3333-0000' })).toBe('+55 11 3333-0000');
    expect(defaultName({ kind: 'sms', number: '+55 11 3333-0000', message: 'hi' })).toBe(
      'Text +55 11 3333-0000',
    );
    expect(
      defaultName({
        ...(emptyForm('wifi') as Extract<PayloadForm, { kind: 'wifi' }>),
        ssid: 'Office-5G',
      }),
    ).toBe('Office-5G');
    expect(defaultName({ kind: 'geo', latitude: '-23.55', longitude: '-46.63' })).toBe(
      '-23.55, -46.63',
    );
    const contact = emptyForm('contact') as Extract<PayloadForm, { kind: 'contact' }>;
    expect(defaultName({ ...contact, givenName: 'Ana', familyName: 'Souza' })).toBe('Ana Souza');
  });

  it('falls back to the kind when there is nothing to name it by', () => {
    expect(defaultName(emptyForm('link'))).toBe('Link');
    expect(defaultName(emptyForm('text'))).toBe('Text');
    expect(defaultName(emptyForm('contact'))).toBe('Contact');
  });
});

describe('checkName', () => {
  it('trims, collapses spaces, and refuses empty or too long', () => {
    expect(checkName('  Menu   board ')).toEqual({ ok: true, name: 'Menu board' });
    expect(checkName('   ')).toMatchObject({ ok: false });
    expect(checkName('x'.repeat(MAX_NAME_LENGTH + 1))).toMatchObject({ ok: false });
    expect(checkName('x'.repeat(MAX_NAME_LENGTH))).toMatchObject({ ok: true });
  });
});

describe('redactForSave', () => {
  const wifi = {
    ...(emptyForm('wifi') as Extract<PayloadForm, { kind: 'wifi' }>),
    ssid: 'Office-5G',
    password: 'hunter2hunter2',
  };

  it('blanks a Wi-Fi password only when asked, and leaves every other kind alone', () => {
    expect(redactForSave(wifi, true)).toEqual(wifi);
    expect(redactForSave(wifi, false)).toEqual({ ...wifi, password: '' });
    const link: PayloadForm = { kind: 'link', url: 'https://example.com/' };
    expect(redactForSave(link, false)).toBe(link);
  });

  it('a redacted Wi-Fi code cannot reopen as it is, and says so', () => {
    expect(reopens(wifi)).toEqual({ ok: true });
    const redacted = reopens(redactForSave(wifi, false));
    expect(redacted.ok).toBe(false);
    if (!redacted.ok) expect(redacted.reason.toLowerCase()).toContain('password');
  });
});

describe('sceneHash', () => {
  it('names the same scene the same and a different scene differently', () => {
    const a = renderScene(encodeText('https://example.com/', 'M')).svg;
    const b = renderScene(encodeText('https://example.com/', 'M')).svg;
    const c = renderScene(encodeText('https://example.org/', 'M')).svg;
    expect(sceneHash(a)).toBe(sceneHash(b));
    expect(sceneHash(a)).not.toBe(sceneHash(c));
    expect(sceneHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('savedWithoutPassword', () => {
  const wifi = {
    ...(emptyForm('wifi') as Extract<PayloadForm, { kind: 'wifi' }>),
    ssid: 'Office-5G',
    password: 'hunter2hunter2',
  };

  it('is a Wi-Fi whose password was not kept, and nothing else', () => {
    expect(savedWithoutPassword(redactForSave(wifi, false))).toBe(true);
    expect(savedWithoutPassword(wifi)).toBe(false);
    // An open network has no password to keep: it reopens, so it is checked like any other.
    expect(savedWithoutPassword({ ...wifi, password: '', security: 'nopass' })).toBe(false);
    // A link that no longer builds is not a withheld password: it is a code that stopped reading.
    expect(savedWithoutPassword({ kind: 'link', url: '' })).toBe(false);
  });
});

describe('recheckVerdict', () => {
  it('names the three outcomes, and a code that does not read is that first', () => {
    expect(recheckVerdict({ sceneMatches: true, verified: true })).toBe('identical');
    expect(recheckVerdict({ sceneMatches: false, verified: true })).toBe('rebuilds-differently');
    expect(recheckVerdict({ sceneMatches: true, verified: false })).toBe('does-not-read');
    expect(recheckVerdict({ sceneMatches: false, verified: false })).toBe('does-not-read');
  });
});

describe('describeRecheck', () => {
  it('says each verdict in one sentence', () => {
    expect(describeRecheck('identical')).toBe('Rebuilds identically and reads.');
    expect(describeRecheck('rebuilds-differently')).toBe(
      'Rebuilds differently from when it was saved, and still reads — check it before you print.',
    );
    expect(describeRecheck('does-not-read')).toBe('No longer reads. Open it to see why.');
    expect(describeRecheck('not-checked')).toBe(
      'Not checked: it was saved without its Wi-Fi password.',
    );
  });
});

describe('summariseRecheck', () => {
  const many = (outcome: RecheckOutcome, n: number): RecheckOutcome[] =>
    Array.from({ length: n }, () => outcome);

  it('counts the codes checked and names only the parts that are not zero, in order', () => {
    expect(summariseRecheck([...many('identical', 11), 'rebuilds-differently'])).toBe(
      '12 codes checked: 11 identical, 1 rebuilds differently.',
    );
    expect(summariseRecheck(many('identical', 3))).toBe('3 codes checked: 3 identical.');
    expect(
      summariseRecheck([
        'does-not-read',
        'identical',
        ...many('rebuilds-differently', 2),
        ...many('does-not-read', 1),
      ]),
    ).toBe('5 codes checked: 1 identical, 2 rebuild differently, 2 no longer read.');
    expect(summariseRecheck(['does-not-read'])).toBe('1 code checked: 1 no longer reads.');
  });

  it('is singular for one code', () => {
    expect(summariseRecheck(['identical'])).toBe('1 code checked: 1 identical.');
  });

  it('says what it left out after the count, never inside it', () => {
    expect(summariseRecheck(['identical', 'identical', 'not-checked'])).toBe(
      '2 codes checked: 2 identical. 1 not checked: saved without its Wi-Fi password.',
    );
    expect(summariseRecheck(many('not-checked', 2))).toBe(
      '2 not checked: saved without their Wi-Fi passwords.',
    );
    expect(summariseRecheck(['identical', 'unanswered'])).toBe(
      '1 code checked: 1 identical. 1 could not be checked.',
    );
    expect(summariseRecheck([])).toBe('There was nothing to check.');
  });
});

describe('recheckTone', () => {
  it('is success only when every code checked is identical and the host answered', () => {
    expect(recheckTone(['identical', 'identical'])).toBe('success');
    // A withheld password is not a failure.
    expect(recheckTone(['identical', 'not-checked'])).toBe('success');
    expect(recheckTone(['identical', 'rebuilds-differently'])).toBe('caution');
    expect(recheckTone(['identical', 'does-not-read'])).toBe('caution');
    expect(recheckTone(['identical', 'unanswered'])).toBe('caution');
    // Nothing checked is nothing proved.
    expect(recheckTone(['not-checked'])).toBe('caution');
    expect(recheckTone([])).toBe('caution');
  });
});

describe('applyKit', () => {
  it('sets the look, the size and the logo, as copies, and never a payload', () => {
    const kit = {
      name: 'Brand',
      style: { ...DEFAULT_STYLE, foreground: '#1a2b3c' },
      eclFloor: 'Q' as const,
      size: { ...DEFAULT_PRINT_SIZE, value: 40 },
      logo: { id: 'abc', plate: 'circle' as const, size: 'medium' as const },
    };
    const applied = applyKit(kit);
    expect(applied).toEqual({ style: kit.style, eclFloor: 'Q', size: kit.size, logo: kit.logo });
    expect(applied.style).not.toBe(kit.style);
    expect(applied.logo).not.toBe(kit.logo);
    expect('form' in applied).toBe(false);
  });
});
