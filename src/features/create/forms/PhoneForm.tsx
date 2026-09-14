import { Input } from '@/ui/Input';

import type { FieldsProps } from './props';

/** A number to call. Spaces and brackets are for reading; the code carries the digits. */
export function PhoneForm({ form, onChange, invalid }: FieldsProps<'phone'>) {
  return (
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
  );
}
