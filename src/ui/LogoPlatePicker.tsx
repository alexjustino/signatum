import { PLATE_LABELS, PLATES, type Plate } from '@/domain/logo';

import { Select } from './Select';

/**
 * The plate under the logo (DESIGN_SYSTEM §8, this product's own primitives).
 *
 * The plate is the shape the code clears behind the logo, drawn into the scene
 * by the domain so that it is part of the artefact the decoder reads — not a
 * decoration painted over it afterwards. The choice is named, never carried by
 * a swatch alone: "Circle" is a word before it is a picture, which is what makes
 * it reachable by keyboard and readable aloud.
 *
 * It arrives here in F4 with the shape alone. Its padding and its colour join it
 * in F5, when the placement engine gives a person something to decide about
 * them; a control invented ahead of that would be a guess with a type signature.
 */

export function LogoPlatePicker({
  value,
  onChange,
  disabled,
}: {
  value: Plate;
  onChange: (plate: Plate) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">Plate</span>
      <Select
        aria-label="Plate"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Plate)}
      >
        {PLATES.map((plate) => (
          <option key={plate} value={plate}>
            {PLATE_LABELS[plate]}
          </option>
        ))}
      </Select>
    </label>
  );
}
