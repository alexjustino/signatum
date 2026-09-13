/**
 * The canonical determinate progress bar (DESIGN_SYSTEM §8).
 *
 * A real `<progress>` underneath, styled — for the reason `Select` is a real `<select>`: the
 * platform already announces "loading, 68 percent" to a screen reader, and a row of divs
 * pretending to be one announces nothing.
 *
 * The label is **required**. A bar with no accessible name is a moving rectangle to anybody who
 * is not looking at it, and the one thing a person wants to know about a long job is which job
 * it is. The number itself belongs beside the bar, in a caption, in the words of whatever is
 * being counted — "137 of 200" says more than a percentage.
 */
export function ProgressBar({
  label,
  value,
  max,
  className = '',
}: {
  /** What is progressing, named as the screen names it elsewhere. */
  label: string;
  value: number;
  max: number;
  className?: string;
}) {
  return (
    <progress
      aria-label={label}
      value={value}
      max={max}
      className={[
        'h-2 w-full appearance-none overflow-hidden rounded-full border-0 bg-card-hover',
        '[&::-webkit-progress-bar]:bg-card-hover',
        '[&::-webkit-progress-value]:bg-accent [&::-webkit-progress-value]:rounded-full',
        '[&::-moz-progress-bar]:bg-accent',
        className,
      ].join(' ')}
    />
  );
}
