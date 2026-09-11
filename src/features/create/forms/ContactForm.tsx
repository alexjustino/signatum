import { CONTACT_FORMATS, CONTACT_FORMAT_LABELS } from '@/domain/payload/contact';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import type { FieldsProps } from './props';

/**
 * A person, as a phone stores one.
 *
 * The format comes first because it decides everything under it: the same
 * thirteen fields leave as a vCard or as MECARD's single line, and one of them
 * — the title — has nowhere to go in MECARD. What the card will and will not
 * carry is the domain's answer, shown here in the domain's own words, so the
 * line under the format and the payload under the preview stay two readings of
 * one fact rather than two claims.
 *
 * Thirteen fields written out thirteen times is thirteen chances for a label
 * and its accessible name to drift apart, so one local `TextField` holds the
 * shape the sibling forms write inline: the visible label *is* the
 * `aria-label`, by construction rather than by review.
 */
function TextField({
  label,
  value,
  onChange,
  invalid = false,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** True when the builder refused this field. */
  invalid?: boolean;
  placeholder?: string;
  inputMode?: 'tel' | 'email' | 'url';
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">{label}</span>
      <Input
        aria-label={label}
        aria-invalid={invalid}
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        autoComplete="off"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function ContactForm({ form, onChange, invalid, note }: FieldsProps<'contact'>) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Format</span>
          <Select
            aria-label="Format"
            value={form.format}
            onChange={(event) =>
              onChange({ ...form, format: event.target.value as typeof form.format })
            }
          >
            {CONTACT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {CONTACT_FORMAT_LABELS[format]}
              </option>
            ))}
          </Select>
        </label>
        {note !== undefined && <p className="text-caption text-fg-secondary">{note}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Given name"
          value={form.givenName}
          invalid={invalid === 'givenName'}
          placeholder="Ana"
          onChange={(givenName) => onChange({ ...form, givenName })}
        />
        <TextField
          label="Family name"
          value={form.familyName}
          invalid={invalid === 'familyName'}
          placeholder="Souza"
          onChange={(familyName) => onChange({ ...form, familyName })}
        />
        <TextField
          label="Organisation"
          value={form.organisation}
          onChange={(organisation) => onChange({ ...form, organisation })}
        />
        <TextField
          label="Title"
          value={form.title}
          onChange={(title) => onChange({ ...form, title })}
        />
        <TextField
          label="Phone"
          value={form.phone}
          invalid={invalid === 'phone'}
          placeholder="+55 11 3333 0000"
          inputMode="tel"
          onChange={(phone) => onChange({ ...form, phone })}
        />
        <TextField
          label="Mobile"
          value={form.mobile}
          invalid={invalid === 'mobile'}
          placeholder="+55 11 99999 0000"
          inputMode="tel"
          onChange={(mobile) => onChange({ ...form, mobile })}
        />
        <TextField
          label="E-mail"
          value={form.email}
          invalid={invalid === 'email'}
          placeholder="ana@example.com"
          inputMode="email"
          onChange={(email) => onChange({ ...form, email })}
        />
        <TextField
          label="Website"
          value={form.url}
          invalid={invalid === 'url'}
          placeholder="https://example.com"
          inputMode="url"
          onChange={(url) => onChange({ ...form, url })}
        />
        <TextField
          label="Street"
          value={form.street}
          onChange={(street) => onChange({ ...form, street })}
        />
        <TextField
          label="City"
          value={form.city}
          onChange={(city) => onChange({ ...form, city })}
        />
        <TextField
          label="Region"
          value={form.region}
          onChange={(region) => onChange({ ...form, region })}
        />
        <TextField
          label="Postcode"
          value={form.postcode}
          onChange={(postcode) => onChange({ ...form, postcode })}
        />
        <TextField
          label="Country"
          value={form.country}
          onChange={(country) => onChange({ ...form, country })}
        />

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-caption font-semibold text-fg-secondary">Note</span>
          <TextArea
            aria-label="Note"
            aria-invalid={invalid === 'note'}
            value={form.note}
            onChange={(event) => onChange({ ...form, note: event.target.value })}
          />
        </label>
      </div>
    </>
  );
}
