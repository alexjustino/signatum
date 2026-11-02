import { useMemo, useRef, useState } from 'react';

import type { ScanMarginRequest, DamageReport } from '@/data/codes';
import { describeError } from '@/data/errors';
import { useDamageTest } from '@/data/hooks';
import type { LogoBox } from '@/domain/logo';
import type { Matrix } from '@/domain/qr/encode';
import {
  blockBudgets,
  headroom,
  predictDamage,
  weakestSpot,
  type BlockBudget,
  type Damage,
  type Headroom,
  type Prediction,
  type WeakestSpot,
} from '@/domain/resilience';

import { blockPaths } from './weakSpots';

/** What the brush leaves where it is dragged: ink, or bare paper. */
export type Brush = 'ink' | 'paper';

/** The same empty list every render, so nothing memoised on it recomputes for nothing. */
const NO_CELLS: readonly Damage[] = [];

/** What the arithmetic knows about a code before anybody touches it. Computed once per plan. */
export interface BreakAnalysis {
  budgets: BlockBudget[];
  spot: WeakestSpot | null;
  headroom: Headroom;
  /** One SVG path per block, for the overlay's tint. */
  paths: string[];
}

/**
 * The decoder's answer, and the damage it is an answer about. Like every answer on Create, it
 * carries what it was asked about, so an answer about yesterday's smudge is never shown beside
 * today's (see `Answer` in `CreatePage`).
 */
interface DecoderAnswer {
  key: string;
  pending: boolean;
  report: DamageReport | null;
  /** Set when the decoder could not be asked at all — not an answer. */
  failure: string | null;
}

export interface BreakTest {
  analysis: BreakAnalysis | null;
  /** The damage on the code on screen, in symbol coordinates. */
  cells: readonly Damage[];
  /** What the arithmetic says about that damage; null while there is none. */
  prediction: Prediction | null;
  /** The blocks as they stand now: with the damage when there is some, before it otherwise. */
  blocks: BlockBudget[];
  shown: boolean;
  setShown: (shown: boolean) => void;
  drawing: boolean;
  setDrawing: (drawing: boolean) => void;
  /** Whether a pointer stroke is in progress right now: the result is not announced until it ends. */
  stroking: boolean;
  setStroking: (stroking: boolean) => void;
  brush: Brush;
  setBrush: (brush: Brush) => void;
  smudge: () => void;
  paint: (cell: { x: number; y: number }) => void;
  clear: () => void;
  ask: () => void;
  /** The decoder's answer about the damage on screen now, or null when it has not been asked. */
  answer: Omit<DecoderAnswer, 'key'> | null;
}

/**
 * The state behind "Where it breaks" (P9, ADR-037): the code's weak places, the damage somebody
 * smudged or drew on it, the arithmetic's prediction and the decoder's answer.
 *
 * It lives in a hook that Create calls rather than in the card, because it outlives the card: the
 * card is shown only while the code is verified, and the damage and the decoder's answer are kept
 * under the artefact they are about, so a code that comes back finds them as they were.
 *
 * `matrix` is null until the gate has passed: there is nothing to break about a code that does
 * not read, and the weakest spot (a ten-millisecond search) is not run while somebody is typing.
 * `codeKey` is the artefact the gate verified; damage and the decoder's answer are kept under it,
 * so a change of code leaves both behind without anything having to reset them.
 *
 * It decides nothing about the code. It never reaches the gate or the export row (ADR-027).
 */
export function useBreakTest({
  matrix,
  plate,
  quietZone,
  codeKey,
  request,
}: {
  matrix: Matrix | null;
  plate: LogoBox | null;
  quietZone: number;
  codeKey: string | null;
  /** The picture the gate verified, as the margin is asked about it; null when there is none. */
  request: ScanMarginRequest | null;
}): BreakTest {
  const analysis = useMemo<BreakAnalysis | null>(() => {
    if (matrix === null) return null;
    const spot = weakestSpot(matrix, plate, quietZone);
    return {
      budgets: blockBudgets(matrix, plate, quietZone),
      spot,
      headroom: headroom(matrix, plate, quietZone, spot),
      paths: blockPaths(matrix, plate, quietZone),
    };
  }, [matrix, plate, quietZone]);

  const [shown, setShown] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [stroking, setStroking] = useState(false);
  const [brush, setBrush] = useState<Brush>('ink');
  const [damage, setDamage] = useState<{ key: string; cells: readonly Damage[] } | null>(null);
  const [answer, setAnswer] = useState<DecoderAnswer | null>(null);
  const { mutateAsync: test } = useDamageTest();
  /** Which ask is the latest: an older answer arriving late must not replace a newer question. */
  const latest = useRef(0);

  const cells =
    damage !== null && codeKey !== null && damage.key === codeKey ? damage.cells : NO_CELLS;

  const prediction = useMemo(
    () =>
      matrix === null || cells.length === 0 ? null : predictDamage(matrix, plate, quietZone, cells),
    [matrix, plate, quietZone, cells],
  );

  /** The code and the damage on it, as one string: what a decoder's answer is about. */
  const askedKey = useMemo(
    () =>
      codeKey === null
        ? null
        : `${codeKey}\n${cells.map((c) => `${c.x},${c.y},${c.dark ? 1 : 0}`).join(';')}`,
    [codeKey, cells],
  );

  const smudge = () => {
    const spot = analysis?.spot ?? null;
    if (matrix === null || codeKey === null || spot === null) return;
    // Every module the spot covers, turned over: ink where the code has paper, paper where it has
    // ink. The worst a smudge can do, and what the domain's guarantee is counted against.
    setDamage({
      key: codeKey,
      cells: spot.cells.map(({ x, y }) => ({ x, y, dark: matrix.modules[y]?.[x] !== true })),
    });
  };

  const paint = (cell: { x: number; y: number }) => {
    if (codeKey === null) return;
    const dark = brush === 'ink';
    setDamage((previous) => {
      const base = previous !== null && previous.key === codeKey ? previous.cells : NO_CELLS;
      const at = base.findIndex((d) => d.x === cell.x && d.y === cell.y);
      // The same stroke over the same module changes nothing, and is not a new render.
      if (at >= 0 && base[at]?.dark === dark) return previous;
      // One entry per module, the last stroke winning — so the list can never outgrow the
      // symbol, which is the host's bound on it.
      return {
        key: codeKey,
        cells: [...base.filter((_, i) => i !== at), { x: cell.x, y: cell.y, dark }],
      };
    });
  };

  const clear = () => {
    latest.current += 1;
    setDamage(null);
    setAnswer(null);
  };

  const ask = () => {
    if (request === null || askedKey === null) return;
    latest.current += 1;
    const ticket = latest.current;
    const key = askedKey;
    setAnswer({ key, pending: true, report: null, failure: null });
    test({ ...request, quietZone, cells })
      .then((report) => {
        if (latest.current === ticket) setAnswer({ key, pending: false, report, failure: null });
      })
      .catch((error: unknown) => {
        if (latest.current === ticket) {
          setAnswer({ key, pending: false, report: null, failure: describeError(error) });
        }
      });
  };

  const answerNow =
    answer !== null && answer.key === askedKey
      ? { pending: answer.pending, report: answer.report, failure: answer.failure }
      : null;

  return {
    analysis,
    cells,
    prediction,
    blocks: prediction?.blocks ?? analysis?.budgets ?? [],
    shown,
    setShown,
    drawing,
    setDrawing,
    stroking,
    setStroking,
    brush,
    setBrush,
    smudge,
    paint,
    clear,
    ask,
    answer: answerNow,
  };
}
