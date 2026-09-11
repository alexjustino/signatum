import { Input } from '@/ui/Input';

import type { FieldsProps } from './props';

/** A place, in decimal degrees — the form every map application reads. */
export function GeoForm({ form, onChange, invalid }: FieldsProps<'geo'>) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Latitude</span>
        <Input
          aria-label="Latitude"
          aria-invalid={invalid === 'latitude'}
          placeholder="-23.5505"
          value={form.latitude}
          spellCheck={false}
          autoComplete="off"
          inputMode="decimal"
          onChange={(event) => onChange({ ...form, latitude: event.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Longitude</span>
        <Input
          aria-label="Longitude"
          aria-invalid={invalid === 'longitude'}
          placeholder="-46.6333"
          value={form.longitude}
          spellCheck={false}
          autoComplete="off"
          inputMode="decimal"
          onChange={(event) => onChange({ ...form, longitude: event.target.value })}
        />
      </label>
    </>
  );
}
