/**
 * What a code can carry, and the one sentence that says what scanning it does.
 *
 * A payload kind is three things that have to agree: a form the screen can show, a string the
 * code carries byte for byte, and a sentence a person reads before printing ten thousand of
 * them. They are decided here, together, because a kind whose preview says one thing and whose
 * bytes say another is the failure this product exists to prevent.
 *
 * Each kind lives in its own file beside this one and exports `build<Kind>(form)`. This module
 * owns only what is shared: the list, the labels, the union, and the dispatch. The link is the
 * exception — it arrived in F0 with its own parser (`link.ts`), and the adapter below reuses it
 * rather than restating rules that already have tests.
 *
 * Every builder is pure and total: it either returns the exact bytes and the sentence, or it
 * returns one sentence naming the field that is wrong. Nothing throws, because a half-typed
 * form is the normal state of a form, not an error.
 */

import { buildContact } from './contact';
import { buildEmail } from './email';
import { buildGeo } from './geo';
import { describeLink, parseLink } from './link';
import { buildPhone } from './phone';
import { buildSms } from './sms';
import { buildText } from './text';
import { buildWifi } from './wifi';

import type { ContactForm } from './contact';
import type { EmailForm } from './email';
import type { GeoForm } from './geo';
import type { PhoneForm } from './phone';
import type { SmsForm } from './sms';
import type { TextForm } from './text';
import type { WifiForm } from './wifi';

export type PayloadKind = 'link' | 'text' | 'email' | 'phone' | 'sms' | 'wifi' | 'geo' | 'contact';

/** The order the kinds are offered in, from the most common to the most specific. */
export const PAYLOAD_KINDS: readonly PayloadKind[] = [
  'link',
  'text',
  'email',
  'phone',
  'sms',
  'wifi',
  'geo',
  'contact',
] as const;

/** What each kind is called on screen. */
export const PAYLOAD_LABELS: Record<PayloadKind, string> = {
  link: 'Link',
  text: 'Text',
  email: 'E-mail',
  phone: 'Phone',
  sms: 'SMS',
  wifi: 'Wi-Fi',
  geo: 'Location',
  contact: 'Contact',
};

/**
 * The result of building a payload: either the bytes plus the sentence, or the reason and the
 * field to point at. `field` is a key of the kind's own form, so the screen can move focus
 * without a second map from reason to input.
 */
export type PayloadResult =
  | {
      ok: true;
      payload: string;
      summary: string;
      /**
       * What the accepted payload could not carry, when the kind's chosen format has nowhere to
       * put something that was typed — MECARD and a job title. It is not a refusal: the code is
       * built, and the screen says what was left out rather than letting a person find out from
       * the phone that imported it.
       */
      note?: string;
    }
  | { ok: false; reason: string; field?: string };

/** The link form. Its rules live in `link.ts`, where F0 left them. */
export interface LinkForm {
  kind: 'link';
  url: string;
}

export type PayloadForm =
  LinkForm | TextForm | EmailForm | PhoneForm | SmsForm | WifiForm | GeoForm | ContactForm;

/** The F0 parser, dressed as a builder so the dispatch has one shape. */
function buildLink(form: LinkForm): PayloadResult {
  const link = parseLink(form.url);
  if (!link.ok) {
    return { ok: false, reason: link.reason, field: 'url' };
  }
  return { ok: true, payload: link.url, summary: describeLink(link.url) };
}

/** Build the bytes for whichever kind the form is. */
export function buildPayload(form: PayloadForm): PayloadResult {
  switch (form.kind) {
    case 'link':
      return buildLink(form);
    case 'text':
      return buildText(form);
    case 'email':
      return buildEmail(form);
    case 'phone':
      return buildPhone(form);
    case 'sms':
      return buildSms(form);
    case 'wifi':
      return buildWifi(form);
    case 'geo':
      return buildGeo(form);
    case 'contact':
      return buildContact(form);
  }
}

/**
 * A blank form of the kind. Every one of them is refused by `buildPayload` — an empty form is
 * never a code — which is what keeps the screen from offering an export before anything is typed.
 */
export function emptyForm(kind: PayloadKind): PayloadForm {
  switch (kind) {
    case 'link':
      return { kind: 'link', url: '' };
    case 'text':
      return { kind: 'text', text: '' };
    case 'email':
      return { kind: 'email', to: '', subject: '', body: '' };
    case 'phone':
      return { kind: 'phone', number: '' };
    case 'sms':
      return { kind: 'sms', number: '', message: '' };
    case 'wifi':
      return { kind: 'wifi', ssid: '', password: '', security: 'WPA', hidden: false };
    case 'geo':
      return { kind: 'geo', latitude: '', longitude: '' };
    case 'contact':
      return {
        kind: 'contact',
        format: 'vcard3',
        givenName: '',
        familyName: '',
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
  }
}

/**
 * The line under the form: what scanning does, or why there is nothing to scan yet. One
 * function, so the helper text and the preview's accessible name cannot drift apart.
 */
export function describePayload(form: PayloadForm): string {
  const result = buildPayload(form);
  return result.ok ? result.summary : result.reason;
}
