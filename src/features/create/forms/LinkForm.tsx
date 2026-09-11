import { Input } from '@/ui/Input';

import type { FieldsProps } from './props';

/** A web address. The kind F0 shipped with, and the shape the six others copy. */
export function LinkForm({ form, onChange, invalid }: FieldsProps<'link'>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">Link</span>
      <Input
        aria-label="Link"
        aria-invalid={invalid === 'url'}
        placeholder="https://"
        value={form.url}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange({ ...form, url: event.target.value })}
      />
    </label>
  );
}
