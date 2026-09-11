import { Input } from '@/ui/Input';
import { TextArea } from '@/ui/TextArea';

import type { FieldsProps } from './props';

/** A text message, written in advance. */
export function SmsForm({ form, onChange, invalid }: FieldsProps<'sms'>) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Number</span>
        <Input
          aria-label="Number"
          aria-invalid={invalid === 'number'}
          placeholder="+55 11 99999 0000"
          value={form.number}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ ...form, number: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Message</span>
        <TextArea
          aria-label="Message"
          aria-invalid={invalid === 'message'}
          value={form.message}
          onChange={(event) => onChange({ ...form, message: event.target.value })}
        />
      </label>
    </>
  );
}
