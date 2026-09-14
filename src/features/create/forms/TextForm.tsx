import { TextArea } from '@/ui/TextArea';

import type { FieldsProps } from './props';

/** Words, carried as they were typed. */
export function TextForm({ form, onChange, invalid }: FieldsProps<'text'>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">Text</span>
      <TextArea
        aria-label="Text"
        aria-invalid={invalid === 'text'}
        placeholder="Anything a camera should show"
        value={form.text}
        onChange={(event) => onChange({ ...form, text: event.target.value })}
      />
    </label>
  );
}
