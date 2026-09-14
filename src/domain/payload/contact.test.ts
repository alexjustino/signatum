import { describe, expect, it } from 'vitest';

import {
  CONTACT_FORMATS,
  CONTACT_FORMAT_LABELS,
  MAX_LINE_OCTETS,
  MECARD_TITLE_NOTE,
  buildContact,
} from './contact';
import { utf8ByteLength } from './text';

import type { ContactForm, ContactFormat } from './contact';

import { MAX_PAYLOAD_BYTES } from '../qr/encode';

/** One card, filled in, in the words a person would type them. */
const card: ContactForm = {
  kind: 'contact',
  format: 'vcard3',
  givenName: 'Ana',
  familyName: 'Souza',
  organisation: 'Example Ltd',
  title: 'Engineer',
  phone: '+55 11 3333-0000',
  mobile: '+55 (11) 99999-0000',
  email: 'ana@example.com',
  url: 'https://example.com',
  street: 'Rua A 1',
  city: 'São Paulo',
  region: 'SP',
  postcode: '01000-000',
  country: 'Brazil',
  note: '',
};

/** The card with nothing in it but a name — the smallest card there is. */
const bare: ContactForm = {
  ...card,
  organisation: '',
  title: '',
  phone: '',
  mobile: '',
  email: '',
  url: '',
  street: '',
  city: '',
  region: '',
  postcode: '',
  country: '',
  note: '',
};

function payloadOf(form: ContactForm): string {
  const result = buildContact(form);
  if (!result.ok) throw new Error(`expected a card, got: ${result.reason}`);
  return result.payload;
}

const VCARD3 =
  'BEGIN:VCARD\r\n' +
  'VERSION:3.0\r\n' +
  'N:Souza;Ana;;;\r\n' +
  'FN:Ana Souza\r\n' +
  'ORG:Example Ltd\r\n' +
  'TITLE:Engineer\r\n' +
  'TEL;TYPE=WORK,VOICE:+551133330000\r\n' +
  'TEL;TYPE=CELL:+5511999990000\r\n' +
  'EMAIL;TYPE=INTERNET:ana@example.com\r\n' +
  'URL:https://example.com/\r\n' +
  'ADR;TYPE=WORK:;;Rua A 1;São Paulo;SP;01000-000;Brazil\r\n' +
  'END:VCARD\r\n';

const VCARD4 =
  'BEGIN:VCARD\r\n' +
  'VERSION:4.0\r\n' +
  'KIND:individual\r\n' +
  'N:Souza;Ana;;;\r\n' +
  'FN:Ana Souza\r\n' +
  'ORG:Example Ltd\r\n' +
  'TITLE:Engineer\r\n' +
  'TEL;TYPE=work,voice;VALUE=uri:tel:+551133330000\r\n' +
  'TEL;TYPE=cell;VALUE=uri:tel:+5511999990000\r\n' +
  'EMAIL:ana@example.com\r\n' +
  'URL:https://example.com/\r\n' +
  'ADR;TYPE=work:;;Rua A 1;São Paulo;SP;01000-000;Brazil\r\n' +
  'END:VCARD\r\n';

const MECARD =
  'MECARD:N:Souza,Ana;ORG:Example Ltd;TEL:+551133330000;TEL:+5511999990000;' +
  'EMAIL:ana@example.com;URL:https\\://example.com/;' +
  'ADR:Rua A 1,São Paulo,SP,01000-000,Brazil;;';

/**
 * A reader shaped like the thing that will read the card: unfold, split on CRLF, cut each line
 * at the first colon, split the value on *unescaped* `;`, and unescape each component. It is
 * here so that the escaping tests assert what an address book sees, not what the string looks
 * like — the same reason `wifi.test.ts` carries a scanner-shaped splitter.
 */
interface VCardLine {
  name: string;
  parameters: string;
  components: string[];
}

function readVCard(payload: string): VCardLine[] {
  const unfolded = payload.replace(/\r\n /g, '');
  return unfolded
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const colon = line.indexOf(':');
      const head = line.slice(0, colon);
      const value = line.slice(colon + 1);
      const semicolon = head.indexOf(';');
      const components: string[] = [];
      let raw = '';
      for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? '';
        if (character === '\\') {
          raw += character + (value[index + 1] ?? '');
          index += 1;
        } else if (character === ';') {
          components.push(raw);
          raw = '';
        } else {
          raw += character;
        }
      }
      components.push(raw);
      return {
        name: semicolon === -1 ? head : head.slice(0, semicolon),
        parameters: semicolon === -1 ? '' : head.slice(semicolon + 1),
        components: components.map((component) =>
          component.replace(/\\(.)/g, (_match, character: string) =>
            character === 'n' || character === 'N' ? '\n' : character,
          ),
        ),
      };
    });
}

function property(payload: string, name: string): VCardLine | undefined {
  return readVCard(payload).find((line) => line.name === name);
}

/** The physical lines, as octets — what the 75 of RFC 6350 §3.2 counts. */
function lineOctets(payload: string): number[] {
  return payload
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map((line) => utf8ByteLength(line));
}

describe('the contact formats', () => {
  it('are offered in one order, the most widely imported one first', () => {
    expect(CONTACT_FORMATS).toEqual(['vcard3', 'vcard4', 'mecard']);
  });

  it('each have a name on screen, and no name is used twice', () => {
    const labels = CONTACT_FORMATS.map((format) => CONTACT_FORMAT_LABELS[format]);
    expect(labels).toEqual(['vCard 3.0', 'vCard 4.0', 'MECARD']);
    expect(new Set(labels).size).toBe(CONTACT_FORMATS.length);
  });
});

describe('buildContact', () => {
  it('writes vCard 3.0 byte for byte, CRLF included', () => {
    expect(buildContact(card)).toEqual({
      ok: true,
      payload: VCARD3,
      summary: 'Adds Ana Souza to contacts',
    });
  });

  it('writes vCard 4.0 byte for byte, with KIND and the tel URIs', () => {
    expect(buildContact({ ...card, format: 'vcard4' })).toEqual({
      ok: true,
      payload: VCARD4,
      summary: 'Adds Ana Souza to contacts',
    });
  });

  it('writes MECARD as one record, and says what it could not carry', () => {
    expect(buildContact({ ...card, format: 'mecard' })).toEqual({
      ok: true,
      payload: MECARD,
      summary: 'Adds Ana Souza to contacts',
      note: MECARD_TITLE_NOTE,
    });
    expect(MECARD.endsWith(';;')).toBe(true);
  });

  it('keeps VERSION immediately after BEGIN, where both RFCs put it', () => {
    for (const format of ['vcard3', 'vcard4'] as const) {
      const lines = readVCard(payloadOf({ ...card, format })).map((line) => line.name);
      expect(lines[0]).toBe('BEGIN');
      expect(lines[1]).toBe('VERSION');
      expect(lines[lines.length - 1]).toBe('END');
    }
    expect(readVCard(payloadOf({ ...card, format: 'vcard4' }))[2]?.name).toBe('KIND');
  });

  it('says in one line what scanning the card does', () => {
    expect(buildContact(card)).toMatchObject({ summary: 'Adds Ana Souza to contacts' });
    expect(buildContact({ ...card, givenName: ' Ana ', familyName: ' Souza ' })).toMatchObject({
      summary: 'Adds Ana Souza to contacts',
    });
    expect(buildContact({ ...card, givenName: '' })).toMatchObject({
      summary: 'Adds Souza to contacts',
    });
    expect(buildContact({ ...card, familyName: '' })).toMatchObject({
      summary: 'Adds Ana to contacts',
    });
  });
});

describe('escaping', () => {
  it('does not let a semicolon in a family name become a second component', () => {
    const result = payloadOf({ ...card, familyName: "O'Brien; Jr" });
    expect(result).toContain("N:O'Brien\\; Jr;Ana;;;\r\n");
    expect(result).toContain("FN:Ana O'Brien\\; Jr\r\n");
    const name = property(result, 'N');
    expect(name?.components).toEqual(["O'Brien; Jr", 'Ana', '', '', '']);
  });

  it('escapes a comma in an organisation instead of splitting the value', () => {
    const result = payloadOf({ ...card, organisation: 'Example, Ltd' });
    expect(result).toContain('ORG:Example\\, Ltd\r\n');
    expect(property(result, 'ORG')?.components).toEqual(['Example, Ltd']);
  });

  it('writes a line break in a note as \\n, and does not escape the escape away', () => {
    const result = payloadOf({ ...card, note: 'Line one\nLine two\\three; four, five' });
    expect(result).toContain('NOTE:Line one\\nLine two\\\\three\\; four\\, five\r\n');
    expect(property(result, 'NOTE')?.components).toEqual(['Line one\nLine two\\three; four, five']);
    // A carriage return is the same line break and is written the same way.
    expect(payloadOf({ ...card, note: 'one\r\ntwo' })).toContain('NOTE:one\\ntwo\r\n');
  });

  it('escapes the components of an address one by one, then joins them', () => {
    const result = payloadOf({ ...card, street: 'Rua A, 1', city: 'São Paulo; Centro' });
    expect(result).toContain('ADR;TYPE=WORK:;;Rua A\\, 1;São Paulo\\; Centro;SP;01000-000;Brazil');
    expect(property(result, 'ADR')?.components).toEqual([
      '',
      '',
      'Rua A, 1',
      'São Paulo; Centro',
      'SP',
      '01000-000',
      'Brazil',
    ]);
  });

  it('escapes MECARD the way WIFI is escaped, the colon included', () => {
    const result = payloadOf({
      ...card,
      format: 'mecard',
      familyName: "O'Brien; Jr",
      organisation: 'Example, Ltd',
      note: 'a\\b',
    });
    expect(result).toContain("N:O'Brien\\; Jr,Ana;");
    expect(result).toContain('ORG:Example\\, Ltd;');
    expect(result).toContain('URL:https\\://example.com/;');
    expect(result).toContain('NOTE:a\\\\b;');
  });
});

describe('what is left out', () => {
  it('omits the properties that were not typed', () => {
    const result = payloadOf(bare);
    expect(result).toBe(
      'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Souza;Ana;;;\r\nFN:Ana Souza\r\nEND:VCARD\r\n',
    );
    for (const name of ['ORG', 'TITLE', 'TEL', 'EMAIL', 'URL', 'ADR', 'NOTE']) {
      expect(result).not.toContain(`${name}:`);
    }
  });

  it('keeps N and FN even when everything else is empty', () => {
    expect(property(payloadOf(bare), 'N')?.components).toEqual(['Souza', 'Ana', '', '', '']);
    expect(property(payloadOf(bare), 'FN')?.components).toEqual(['Ana Souza']);
    const family = { ...bare, givenName: '' };
    expect(payloadOf(family)).toBe(
      'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Souza;;;;\r\nFN:Souza\r\nEND:VCARD\r\n',
    );
  });

  it('writes only the telephone that was typed', () => {
    expect(payloadOf({ ...bare, mobile: '+55 11 99999-0000' })).toContain(
      'TEL;TYPE=CELL:+5511999990000\r\n',
    );
    expect(payloadOf({ ...bare, mobile: '+55 11 99999-0000' })).not.toContain('TYPE=WORK');
  });

  it('leaves ADR out entirely when no part of the address was typed', () => {
    const noAddress = { ...card, street: '', city: '', region: '', postcode: '', country: '' };
    expect(payloadOf(noAddress)).not.toContain('ADR');
    expect(payloadOf({ ...bare, country: 'Brazil' })).toContain('ADR;TYPE=WORK:;;;;;;Brazil\r\n');
  });

  it('drops MECARD components that have no position left to hold', () => {
    expect(payloadOf({ ...bare, format: 'mecard' })).toBe('MECARD:N:Souza,Ana;;');
    // A trailing component has no position to hold; a leading one has to keep its comma.
    expect(payloadOf({ ...bare, format: 'mecard', givenName: '' })).toBe('MECARD:N:Souza;;');
    expect(payloadOf({ ...bare, format: 'mecard', familyName: '' })).toBe('MECARD:N:,Ana;;');
    expect(payloadOf({ ...bare, format: 'mecard', street: 'Rua A 1', city: 'São Paulo' })).toBe(
      'MECARD:N:Souza,Ana;ADR:Rua A 1,São Paulo;;',
    );
  });

  it('says the title was left out of a MECARD, and only when there was one', () => {
    expect(buildContact({ ...card, format: 'mecard' })).toMatchObject({
      note: 'MECARD has no field for a title; it was left out.',
    });
    expect(payloadOf({ ...card, format: 'mecard' })).not.toContain('TITLE');
    expect(buildContact({ ...card, format: 'mecard', title: '' }).ok).toBe(true);
    expect(buildContact({ ...card, format: 'mecard', title: '' })).not.toHaveProperty('note');
    // The vCards have the field, so they never carry the remark.
    expect(buildContact(card)).not.toHaveProperty('note');
    expect(buildContact({ ...card, format: 'vcard4' })).not.toHaveProperty('note');
  });
});

describe('folding', () => {
  // "NOTE:" is five octets, so sixty-nine more fill the line to seventy-four: one octet short of
  // the limit, and the next character is two octets wide. A fold that counted characters, or one
  // that cut at the seventy-fifth octet, would split the `ü` down the middle.
  const note = `${'a'.repeat(69)}über${'b'.repeat(40)}`;

  it('folds a long line with CRLF and a space, at an octet boundary', () => {
    const result = payloadOf({ ...bare, note });
    expect(result).toContain(`NOTE:${'a'.repeat(69)}\r\n über${'b'.repeat(40)}\r\n`);
  });

  it('never splits a multi-byte character, and never writes a line over 75 octets', () => {
    const typed = `${note}${'c'.repeat(200)}ção`;
    const result = payloadOf({ ...bare, note: typed });
    for (const octets of lineOctets(result)) {
      expect(octets).toBeLessThanOrEqual(MAX_LINE_OCTETS);
    }
    // The line before the fold is short by exactly the character that did not fit: seventy-four
    // octets, not seventy-five. A fold taken at the seventy-fifth octet would have cut the `ü`.
    expect(lineOctets(result)).toContain(74);
    // And nothing was lost or mangled on the way in.
    expect(property(result, 'NOTE')?.components).toEqual([typed]);
  });

  it('leaves a line that fits exactly at 75 octets unfolded', () => {
    const exact = payloadOf({ ...bare, note: 'a'.repeat(MAX_LINE_OCTETS - 'NOTE:'.length) });
    expect(exact).toContain(`NOTE:${'a'.repeat(70)}\r\nEND:VCARD`);
    const over = payloadOf({ ...bare, note: 'a'.repeat(MAX_LINE_OCTETS - 'NOTE:'.length + 1) });
    expect(over).toContain(`NOTE:${'a'.repeat(70)}\r\n a\r\nEND:VCARD`);
  });

  it('unfolds back to what was typed', () => {
    const typed = `${note} — and a second sentence, long enough to fold twice; with escapes.`;
    expect(property(payloadOf({ ...bare, note: typed }), 'NOTE')?.components).toEqual([typed]);
  });
});

describe('reading the card back', () => {
  it('gives every typed field back to a reader that unfolds and unescapes', () => {
    const typed: ContactForm = {
      ...card,
      familyName: "O'Brien; Jr",
      organisation: 'Example, Ltd',
      street: 'Rua A, 1',
      note: 'Prefers e-mail before 10:00.\nRing the bell; twice.',
    };
    const lines = readVCard(payloadOf(typed));
    const value = (name: string) => lines.find((line) => line.name === name)?.components ?? [];

    expect(value('N')).toEqual(["O'Brien; Jr", 'Ana', '', '', '']);
    expect(value('FN')).toEqual(["Ana O'Brien; Jr"]);
    expect(value('ORG')).toEqual(['Example, Ltd']);
    expect(value('TITLE')).toEqual(['Engineer']);
    expect(value('EMAIL')).toEqual(['ana@example.com']);
    expect(value('URL')).toEqual(['https://example.com/']);
    expect(value('ADR')).toEqual(['', '', 'Rua A, 1', 'São Paulo', 'SP', '01000-000', 'Brazil']);
    expect(value('NOTE')).toEqual(['Prefers e-mail before 10:00.\nRing the bell; twice.']);

    const telephones = lines.filter((line) => line.name === 'TEL');
    expect(telephones.map((line) => line.components[0])).toEqual([
      '+551133330000',
      '+5511999990000',
    ]);
    expect(telephones.map((line) => line.parameters)).toEqual(['TYPE=WORK,VOICE', 'TYPE=CELL']);
  });
});

describe('the fields it does not validate twice', () => {
  it('normalises a telephone the way the phone kind does', () => {
    expect(payloadOf({ ...bare, phone: '+55 (11) 3333.0000' })).toContain(
      'TEL;TYPE=WORK,VOICE:+551133330000\r\n',
    );
    expect(payloadOf({ ...bare, format: 'vcard4', mobile: '+55 11 99999 0000' })).toContain(
      'TEL;TYPE=cell;VALUE=uri:tel:+5511999990000\r\n',
    );
  });

  it('shows the e-mail domain as it will resolve', () => {
    expect(payloadOf({ ...bare, email: 'ana@EXAMPLE.com' })).toContain(
      'EMAIL;TYPE=INTERNET:ana@example.com\r\n',
    );
  });

  it('writes the website normalised, as the link kind emits it', () => {
    expect(payloadOf({ ...bare, url: 'https://example.com' })).toContain(
      'URL:https://example.com/\r\n',
    );
  });
});

describe('what it refuses', () => {
  it('refuses a card with no name at all', () => {
    expect(buildContact({ ...card, givenName: '', familyName: '' })).toEqual({
      ok: false,
      reason: 'A contact needs at least a name.',
      field: 'givenName',
    });
    expect(buildContact({ ...card, givenName: '   ', familyName: ' ' })).toMatchObject({
      ok: false,
      field: 'givenName',
    });
  });

  it('names the telephone that is wrong, and does not blame the other one', () => {
    expect(buildContact({ ...card, phone: '12' })).toEqual({
      ok: false,
      reason: 'A phone number needs at least 3 digits.',
      field: 'phone',
    });
    expect(buildContact({ ...card, mobile: '+55 11 9999x0000' })).toMatchObject({
      ok: false,
      field: 'mobile',
    });
    expect(buildContact({ ...card, mobile: '1'.repeat(16) })).toMatchObject({
      ok: false,
      field: 'mobile',
    });
  });

  it('refuses an e-mail address that is not one, in the words the e-mail kind uses', () => {
    expect(buildContact({ ...card, email: 'ana' })).toEqual({
      ok: false,
      reason: 'An e-mail address needs an @, like ana@example.com.',
      field: 'email',
    });
    expect(buildContact({ ...card, email: 'ana@' })).toMatchObject({ ok: false, field: 'email' });
  });

  it('refuses a website that is not an http link', () => {
    expect(buildContact({ ...card, url: 'javascript:alert(1)' })).toMatchObject({
      ok: false,
      field: 'url',
    });
    expect(buildContact({ ...card, url: 'example.com' })).toEqual({
      ok: false,
      reason: 'That is not a link. It has to start with https:// or http://.',
      field: 'url',
    });
  });

  it('accepts a card whose optional fields are simply empty', () => {
    expect(buildContact(bare).ok).toBe(true);
    expect(buildContact({ ...bare, phone: '   ', email: ' ', url: ' ' }).ok).toBe(true);
  });

  it('refuses a format that is not one of the three, whatever the type says', () => {
    const tampered = { ...card, format: 'vcard3;evil' as unknown as ContactFormat };
    expect(buildContact(tampered)).toEqual({
      ok: false,
      reason: 'Choose the format the card is written in.',
      field: 'format',
    });
  });

  it('refuses a card no code can carry, and says what to do about it', () => {
    const huge = buildContact({ ...card, note: 'x'.repeat(MAX_PAYLOAD_BYTES) });
    expect(huge.ok).toBe(false);
    expect(huge.ok ? '' : huge.reason).toMatch(
      new RegExp(
        `^A contact card can be at most ${MAX_PAYLOAD_BYTES} bytes long, and this is \\d+\\. ` +
          'Use MECARD, or fewer fields\\.$',
      ),
    );
    // The card is the whole form, so there is no one field to point at.
    expect(huge.ok ? undefined : huge.field).toBeUndefined();
  });

  it('does not tell somebody already writing a MECARD to use MECARD', () => {
    const huge = buildContact({
      ...card,
      format: 'mecard',
      note: 'x'.repeat(MAX_PAYLOAD_BYTES),
    });
    expect(huge.ok ? '' : huge.reason).toContain('Use fewer fields.');
    expect(huge.ok ? '' : huge.reason).not.toContain('MECARD,');
  });

  it('accepts the last byte that fits and refuses the first that does not', () => {
    const mecard: ContactForm = { ...card, format: 'mecard', title: '' };
    const room = MAX_PAYLOAD_BYTES - utf8ByteLength(payloadOf({ ...mecard, note: 'x' })) + 1;
    const exact = buildContact({ ...mecard, note: 'x'.repeat(room) });
    expect(exact.ok).toBe(true);
    expect(exact.ok ? utf8ByteLength(exact.payload) : 0).toBe(MAX_PAYLOAD_BYTES);
    expect(buildContact({ ...mecard, note: 'x'.repeat(room + 1) })).toMatchObject({
      ok: false,
      reason: `A contact card can be at most ${MAX_PAYLOAD_BYTES} bytes long, and this is ${
        MAX_PAYLOAD_BYTES + 1
      }. Use fewer fields.`,
    });
  });
});

describe('a number in a card', () => {
  it('needs its country code, because the card travels', () => {
    expect(buildContact({ ...bare, phone: '(11) 3333-0000' })).toMatchObject({
      ok: false,
      field: 'phone',
    });
    expect(buildContact({ ...bare, mobile: '11 99999 0000' })).toMatchObject({
      ok: false,
      field: 'mobile',
    });
    expect(buildContact({ ...bare, phone: '+55 11 3333-0000' })).toMatchObject({ ok: true });
  });
});
