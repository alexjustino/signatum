import type { PayloadForm } from '@/domain/payload';

import { ContactForm } from './ContactForm';
import { EmailForm } from './EmailForm';
import { GeoForm } from './GeoForm';
import { LinkForm } from './LinkForm';
import { PhoneForm } from './PhoneForm';
import { SmsForm } from './SmsForm';
import { TextForm } from './TextForm';
import { WifiForm } from './WifiForm';

/**
 * The fields of whichever kind is selected.
 *
 * One switch, exhaustive over the union the domain declares — so a kind added
 * there without a form here is a type error rather than an empty panel.
 */
export function PayloadFields({
  form,
  onChange,
  invalid,
  note,
}: {
  form: PayloadForm;
  onChange: (form: PayloadForm) => void;
  invalid: string | undefined;
  /** What the accepted payload could not carry, in the builder's words. */
  note: string | undefined;
}) {
  switch (form.kind) {
    case 'link':
      return <LinkForm form={form} onChange={onChange} invalid={invalid} />;
    case 'text':
      return <TextForm form={form} onChange={onChange} invalid={invalid} />;
    case 'email':
      return <EmailForm form={form} onChange={onChange} invalid={invalid} />;
    case 'phone':
      return <PhoneForm form={form} onChange={onChange} invalid={invalid} />;
    case 'sms':
      return <SmsForm form={form} onChange={onChange} invalid={invalid} />;
    case 'wifi':
      return <WifiForm form={form} onChange={onChange} invalid={invalid} />;
    case 'geo':
      return <GeoForm form={form} onChange={onChange} invalid={invalid} />;
    case 'contact':
      return <ContactForm form={form} onChange={onChange} invalid={invalid} note={note} />;
  }
}
