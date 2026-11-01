import { useRef, type PointerEvent } from 'react';

import type { BlockBudget, Damage, WeakestSpot } from '@/domain/resilience';

import { cellAt, spentStep, type SpentStep } from './weakSpots';

/** The tint of each step, from the token layer — strongest where the block is most spent. */
const STEP_FILL: Record<SpentStep, string> = {
  low: 'fill-(--viz-spent-low)',
  mid: 'fill-(--viz-spent-mid)',
  high: 'fill-(--viz-spent-high)',
};

/**
 * The weak spots, drawn over the code (P9, DESIGN_SYSTEM §8).
 *
 * An `<svg>` in the scene's own units — its viewBox is the scene's `side × side`, and the symbol
 * starts at `quietZone` — so every module it tints lands on the module it is about, at any size
 * and any zoom, with no arithmetic on this side. It follows the outline over somebody else's
 * picture (F10): a drawing about the code and not the code, decorative to anybody who is not
 * looking at it, because the card's sentence and its list of blocks say all of it in words.
 *
 * It is a pointer target only while Draw is on. Then a drag paints one module at a time, snapped
 * to the grid, in whatever the brush leaves; the rest of the time a click goes straight through
 * it, as it does through the logo.
 *
 * The geometry is the one thing here that is a number rather than a token: line widths and
 * dashes are in modules, so they scale with the code like everything else drawn in its units.
 */
export function WeakSpotOverlay({
  side,
  quietZone,
  paths,
  blocks,
  spot,
  cells,
  showWeakSpots,
  drawing,
  onPaint,
  onStroke,
}: {
  /** Modules per side of the scene, quiet zone included. */
  side: number;
  quietZone: number;
  /** One path per block, in scene modules (`blockPaths`). */
  paths: readonly string[];
  /** The blocks as they stand now, damage included — the tint follows the damage. */
  blocks: readonly BlockBudget[];
  spot: WeakestSpot | null;
  cells: readonly Damage[];
  /** Whether the tint and the weakest spot are drawn; damage is drawn either way. */
  showWeakSpots: boolean;
  drawing: boolean;
  onPaint: (cell: { x: number; y: number }) => void;
  /** Told when a stroke starts and ends, so the result can wait for the end to be announced. */
  onStroke: (active: boolean) => void;
}) {
  /** Whether a drag is under way. Read only in handlers, never while rendering. */
  const painting = useRef(false);

  const paintAt = (event: PointerEvent<SVGSVGElement>) => {
    const cell = cellAt(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      side,
      quietZone,
    );
    if (cell !== null) onPaint(cell);
  };

  const stop = () => {
    if (painting.current) onStroke(false);
    painting.current = false;
  };

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${side} ${side}`}
      className={[
        'block size-full',
        drawing ? 'pointer-events-auto cursor-crosshair touch-none' : 'pointer-events-none',
      ].join(' ')}
      onPointerDown={(event) => {
        if (!drawing || event.button !== 0) return;
        // Captured, so a drag that leaves the code and comes back keeps painting, and one that
        // ends outside it still ends.
        event.currentTarget.setPointerCapture(event.pointerId);
        painting.current = true;
        onStroke(true);
        paintAt(event);
      }}
      onPointerMove={(event) => {
        if (drawing && painting.current) paintAt(event);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      {showWeakSpots &&
        paths.map((d, b) => {
          const block = blocks[b];
          return d === '' || block === undefined ? null : (
            <path key={b} d={d} className={STEP_FILL[spentStep(block)]} />
          );
        })}

      {/* Damage is drawn as the host paints it before the decoder reads it — black ink, white
          paper — with a thin outline, so a paper cell still has an edge on a light module. */}
      {cells.map((cell) => (
        <rect
          key={`${cell.x},${cell.y}`}
          x={cell.x + quietZone}
          y={cell.y + quietZone}
          width={1}
          height={1}
          className={`${cell.dark ? 'fill-(--damage-ink)' : 'fill-(--damage-paper)'} stroke-stroke-strong`}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {showWeakSpots && spot !== null && (
        <circle
          cx={spot.x + 0.5 + quietZone}
          cy={spot.y + 0.5 + quietZone}
          r={spot.radius + 0.5}
          className="fill-none stroke-(--viz-spot)"
          strokeWidth={0.3}
          strokeDasharray="0.8 0.5"
        />
      )}
    </svg>
  );
}
