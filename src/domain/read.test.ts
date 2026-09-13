import { describe, expect, it } from 'vitest';

import { buildPayload } from './payload';
import { describeBytes, wouldScanAt } from './read';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('describeBytes', () => {
  it("says what the product's own kinds do, in the same words", () => {
    expect(describeBytes(bytes('https://example.com/menu'))).toMatchObject({
      kind: 'link',
      summary: 'Opens example.com',
      details: [],
    });
    expect(describeBytes(bytes('mailto:ana@example.com?subject=Hi'))).toMatchObject({
      kind: 'email',
      summary: 'Writes to ana@example.com',
    });
    expect(describeBytes(bytes('tel:+5511999990000'))).toMatchObject({
      kind: 'phone',
      summary: 'Calls +5511999990000',
    });
    expect(describeBytes(bytes('SMSTO:+5511999990000:Table for two'))).toMatchObject({
      kind: 'sms',
      summary: 'Texts +5511999990000',
    });
    expect(describeBytes(bytes('geo:-23.5505,-46.6333'))).toMatchObject({
      kind: 'geo',
      summary: 'Opens the map at -23.5505, -46.6333',
    });
    expect(describeBytes(bytes('Table 12'))).toMatchObject({
      kind: 'text',
      summary: 'Shows the text',
    });
  });

  it('shows an internationalised host both ways', () => {
    const read = describeBytes(bytes('https://xn--bcher-kva.example/'));
    expect(read.summary).toBe('Opens xn--bcher-kva.example');
    expect(read.details).toEqual(['Shown as bücher.example, resolves as xn--bcher-kva.example.']);
  });

  it('reads back a Wi-Fi code the product made, unescaping the fields, and masks the password', () => {
    const built = buildPayload({
      kind: 'wifi',
      ssid: 'Café;Office',
      password: 'pa:ss,w"ord\\1',
      security: 'WPA',
      hidden: true,
    });
    if (!built.ok) throw new Error(built.reason);
    const read = describeBytes(bytes(built.payload));
    expect(read).toMatchObject({
      kind: 'wifi',
      summary: 'Joins Café;Office',
      details: ['Security WPA', 'Hidden network'],
      sensitive: true,
    });
  });

  it('reads back a vCard and a MECARD the product made', () => {
    const contact = {
      kind: 'contact' as const,
      format: 'vcard3' as const,
      givenName: 'Ana',
      familyName: "O'Brien; Jr",
      organisation: 'Example, Ltd',
      title: 'Engineer',
      phone: '+55 11 3333-0000',
      mobile: '',
      email: 'ana@example.com',
      url: '',
      street: '',
      city: '',
      region: '',
      postcode: '',
      country: '',
      note: '',
    };
    const vcard = buildPayload(contact);
    if (!vcard.ok) throw new Error(vcard.reason);
    const readCard = describeBytes(bytes(vcard.payload));
    expect(readCard.summary).toBe("Adds Ana O'Brien; Jr to contacts");
    expect(readCard.details).toEqual([
      'vCard 3.0',
      'Organisation Example, Ltd',
      'Title Engineer',
      'E-mail ana@example.com',
      'Phone +551133330000',
    ]);
    const mecard = buildPayload({ ...contact, format: 'mecard' });
    if (!mecard.ok) throw new Error(mecard.reason);
    expect(describeBytes(bytes(mecard.payload))).toMatchObject({
      kind: 'contact',
      summary: "Adds Ana O'Brien; Jr to contacts",
      details: ['MECARD'],
    });
  });

  it('shows bytes that are not text as hexadecimal, and says so', () => {
    const read = describeBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x41]));
    expect(read).toMatchObject({ kind: 'other', content: 'ff fe 00 41' });
    expect(read.details[0]).toContain('4 bytes');
  });
});

describe('wouldScanAt', () => {
  it('answers reads, tight or too small from the module size', () => {
    // A version-2 code with its quiet zone is 33 modules.
    expect(wouldScanAt(33, 25)).toMatchObject({ verdict: 'reads' });
    expect(wouldScanAt(33, 15)).toMatchObject({ verdict: 'tight' });
    expect(wouldScanAt(33, 10)).toMatchObject({ verdict: 'too small' });
    expect(wouldScanAt(33, 25).sentence).toBe(
      'At 25 mm the modules are 0.76 mm — most cameras read that from 30 cm.',
    );
    expect(wouldScanAt(33, 10).sentence).toContain('too small');
  });
});
