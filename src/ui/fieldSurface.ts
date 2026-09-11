/**
 * The surface of a text field, shared by `Input` and `TextArea` so that a
 * single-line and a multi-line field cannot drift into two different-looking
 * controls. Height is deliberately not in here: a line is one control tall, a
 * paragraph is not.
 *
 * It lives beside the two components rather than inside one of them because a
 * component file that also exports a constant loses fast refresh.
 */
export const FIELD_SURFACE = [
  'w-full rounded-md border border-stroke bg-card px-3',
  'text-body text-fg placeholder:text-fg-tertiary',
  'border-b-2 border-b-stroke-strong',
  'transition-colors duration-100 ease-easy',
  'hover:bg-card-hover',
  'focus:border-b-accent focus:bg-card focus:outline-none',
  'disabled:cursor-not-allowed disabled:text-fg-disabled',
].join(' ');
