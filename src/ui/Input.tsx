import type { InputHTMLAttributes } from 'react';

import { FIELD_SURFACE } from './fieldSurface';

/**
 * The canonical text field.
 *
 * The Fluent shape: a filled surface with a heavier bottom stroke that takes the
 * accent colour on focus, rather than a ring drawn around the whole control. The
 * surface itself is shared with `TextArea`, which is the same field with more
 * than one line in it.
 */
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input className={['h-(--density-control)', FIELD_SURFACE, className].join(' ')} {...rest} />
  );
}
