import type { TextareaHTMLAttributes } from 'react';

import { FIELD_SURFACE } from './fieldSurface';

/**
 * The canonical text field, for text that has more than one line in it.
 *
 * It is an `Input` that grew: the same surface constant, so the two cannot
 * drift apart, with the control height replaced by a minimum of a few lines and
 * the vertical padding a single-line field gets from its height. It resizes
 * vertically only — a field that can be dragged wider than its column breaks
 * the layout it sits in.
 */
export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={['min-h-24 resize-y py-2 leading-normal', FIELD_SURFACE, className].join(' ')}
      {...rest}
    />
  );
}
