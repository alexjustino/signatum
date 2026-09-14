import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  applyKit,
  checkName,
  defaultName,
  redactForSave,
  reopens,
  sceneHash,
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
