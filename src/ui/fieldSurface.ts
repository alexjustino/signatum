/**
 * The surface of a text field, shared by `Input` and `TextArea` so that a
 * single-line and a multi-line field cannot drift into two different-looking
 * controls. Height is deliberately not in here: a line is one control tall, a
 * paragraph is not.
 *
 * It lives beside the two components rather than inside one of them because a
 * component file that also exports a constant loses fast refresh.
 */

/**
 * The chrome of a field — its border, its fill, and how both answer hover and
 * focus — without the geometry of a field that holds text. A control that is a
 * field but not a text box takes this, so that a colour swatch beside a hex box
 * is visibly the same control rather than an approximation of one
 * (DESIGN_SYSTEM §1).
 */
export const FIELD_CHROME = [
  'rounded-md border border-stroke bg-card',
  'border-b-2 border-b-stroke-strong',
  'transition-colors duration-100 ease-easy',
  'hover:bg-card-hover',
  'focus:border-b-accent focus:bg-card focus:outline-none',
  'disabled:cursor-not-allowed disabled:text-fg-disabled',
].join(' ');

export const FIELD_SURFACE = [
  'w-full px-3',
  'text-body text-fg placeholder:text-fg-tertiary',
  FIELD_CHROME,
].join(' ');
