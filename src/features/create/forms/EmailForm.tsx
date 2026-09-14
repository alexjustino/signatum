import { Input } from '@/ui/Input';
import { TextArea } from '@/ui/TextArea';

import type { FieldsProps } from './props';

/** A message waiting to be sent: the address is required, the rest is a head start. */
export function EmailForm({ form, onChange, invalid }: FieldsProps<'email'>) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">To</span>
        <Input
          aria-label="To"
          aria-invalid={invalid === 'to'}
          placeholder="ana@example.com"
          value={form.to}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ ...form, to: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Subject</span>
        <Input
          aria-label="Subject"
          aria-invalid={invalid === 'subject'}
          value={form.subject}
          onChange={(event) => onChange({ ...form, subject: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Body</span>
        <TextArea
          aria-label="Body"
          aria-invalid={invalid === 'body'}
          value={form.body}
          onChange={(event) => onChange({ ...form, body: event.target.value })}
        />
      </label>
    </>
  );
}
