import {
  Checkmark16Regular,
  Dismiss16Regular,
  Info16Regular,
  Library24Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { VerificationReport, VerifyRequest } from '@/data/codes';
import { describeError } from '@/data/errors';
import {
  useCode,
  useCodes,
  useDeleteCode,
  useFetchCode,
  useLogoDataUrl,
  useRenameCode,
  useVerifyCode,
} from '@/data/hooks';
import type { SavedCode, SavedCodeSummary } from '@/data/library';
import { describeCode } from '@/domain/describe';
import {
  checkName,
  describeRecheck,
  recheckTone,
  recheckVerdict,
  reopens,
  savedWithoutPassword,
  sceneHash,
  summariseRecheck,
  type RecheckOutcome,
} from '@/domain/library';
import type { LogoBox } from '@/domain/logo';
import { buildPayload, PAYLOAD_LABELS } from '@/domain/payload';
import { checkPrintSize, pixelsFor } from '@/domain/size';
import { checkContrast } from '@/domain/style';
import { planFor, sceneFor } from '@/features/create/plan';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { CodePreview } from '@/ui/CodePreview';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { ProgressBar } from '@/ui/ProgressBar';

/**
 * The library: the codes that were kept (SPEC §2.7).
 *
 * A saved code is its fields and the digest of the scene they made — never a stored picture
 * (ADR-028). So every row here draws its own code, now, through the same domain the Create screen
 * uses: the payload is built, the placement engine plans it, the scene renders it. That is what
 * makes "reopened exactly as it was" a claim this product can check instead of assert, and it is
 * why a row for a code that can no longer be made — a Wi-Fi whose password was deliberately not
 * kept — says so in a sentence where its preview would have been.
 *
 * Opening a code hands everything back to the shell and goes to Create, where the gate verifies
 * it again. Nothing leaves this screen without passing the same gate as a code typed by hand.
 */

/** A saved code rebuilt from its stored fields: the scene and what it carries, or why there is none. */
type Rebuilt =
  | { ok: true; svg: string; side: number; box: LogoBox | null; name: string; payload: string }
  | { ok: false; reason: string };

/**
 * The code a row draws, rebuilt from the stored fields — and the code the library's check asks
 * the decoder about. One function for both, so the picture a row shows and the scene that was
 * checked cannot be two different rebuilds.
 *
 * Every refusal on the way is a sentence rather than an empty box: a payload that cannot be
 * built, a plan that will not carry the logo, a pair of colours no camera reads, a size nothing
 * is printed at. They are the domain's words, the same ones the Create screen shows.
 */
function rebuild(saved: SavedCode): Rebuilt {
  const none = (reason: string): Rebuilt => ({ ok: false, reason });

  const reopened = reopens(saved.form);
  if (!reopened.ok) return none(reopened.reason);

  const built = buildPayload(saved.form);
  if (!built.ok) return none(built.reason);

  const size = checkPrintSize(saved.size);
  if (!size.ok) return none(size.reason);

  const contrast = checkContrast(saved.style);
  if (!contrast.ok) return none(contrast.reason);

  const plan = planFor(built.payload, {
    logoSize: saved.logo?.size ?? null,
    quietZone: saved.style.quietZone,
    ecl: saved.eclFloor,
  });
  if (!plan.ok) return none(plan.reason);

  const name = describeCode(built.summary);
  const rendered = sceneFor(plan, saved.style, name, saved.logo?.plate ?? null);
  if (rendered.failure !== null) return none(rendered.failure);

  return {
    ok: true,
    svg: rendered.svg,
    side: rendered.side,
    box: plan.box,
    name,
    payload: built.payload,
  };
}

/** What checking one row again said: the outcome, and the sentence the row shows for it. */
interface RowCheck {
  outcome: RecheckOutcome;
  sentence: string;
}

/**
 * Check one saved code again (P5): rebuild it, compare the scene with the digest it was saved
 * with, and ask the decoder about it now — with its `code_id`, so the reading is recorded against
 * the row it is about, as an Open would record it.
 *
 * A Wi-Fi saved without its password is not checked at all: there is nothing to rebuild, and it
 * is not a failure. A code whose fields no longer make a code is one that no longer reads — it is
 * the rebuild that refused, and opening it shows the refusal in Create's words.
 */
async function checkOne(
  saved: SavedCode,
  verify: (request: VerifyRequest) => Promise<VerificationReport>,
): Promise<RowCheck> {
  if (savedWithoutPassword(saved.form)) {
    return { outcome: 'not-checked', sentence: describeRecheck('not-checked') };
  }
  const rebuilt = rebuild(saved);
  if (!rebuilt.ok) {
    return { outcome: 'does-not-read', sentence: describeRecheck('does-not-read') };
  }
  const report = await verify({
    svg: rebuilt.svg,
    payload: rebuilt.payload,
    pixelSize: pixelsFor(saved.size),
    logo:
      saved.logo === null || rebuilt.box === null ? null : { id: saved.logo.id, ...rebuilt.box },
    codeId: saved.id,
  });
  const verdict = recheckVerdict({
    sceneMatches: sceneHash(rebuilt.svg) === saved.sceneSha256,
    verified: report.verified,
  });
  return { outcome: verdict, sentence: describeRecheck(verdict) };
}

/** The mark beside a row's verdict — redundant with the sentence by construction (§2). */
const CHECK_MARK: Record<RecheckOutcome, { icon: ReactNode; tone: string }> = {
  identical: { icon: <Checkmark16Regular />, tone: 'text-success' },
  'rebuilds-differently': { icon: <Warning16Regular />, tone: 'text-caution' },
  'does-not-read': { icon: <Dismiss16Regular />, tone: 'text-danger' },
  'not-checked': { icon: <Info16Regular />, tone: 'text-fg-tertiary' },
  unanswered: { icon: <Warning16Regular />, tone: 'text-caution' },
};

/** The day a code was kept, in the reader's own format; the stored text when it is not a date. */
function day(stamp: string): string {
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? stamp : at.toLocaleDateString();
}

export function LibraryPage({
  onOpen,
}: {
  /**
   * Load a saved code into the editor and go there. It answers rather than throws: a logo the
   * store can no longer produce is a reason to show, not a screen to lose.
   */
  onOpen: (saved: SavedCode) => Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const codes = useCodes();
  const fetchCode = useFetchCode();
  const { mutateAsync: verify } = useVerifyCode();

  /** Each row's line from the last check, by saved code id. */
  const [checks, setChecks] = useState<Record<string, RowCheck>>({});
  /** How far the check has got, while one is running; null otherwise. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Whether a check ran to its end — the summary is about a finished check, never half of one. */
  const [finished, setFinished] = useState(false);

  // A check outlives nothing: leaving the screen stops it after the code being checked, and
  // nothing is set or announced about a screen that is no longer there.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = progress !== null;
  const list = codes.data;

  /**
   * Check every saved code again, in list order, one at a time (P5). Never in parallel: each one
   * is a render and a decode on the host, and twelve at once would be twelve rasters competing for
   * the machine the person is still using.
   */
  const checkAll = async () => {
    if (list === undefined || list.length === 0 || running) return;
    const found: Record<string, RowCheck> = {};
    setChecks({});
    setFinished(false);
    setProgress({ done: 0, total: list.length });
    for (const [index, each] of list.entries()) {
      let row: RowCheck;
      try {
        row = await checkOne(await fetchCode(each.id), verify);
      } catch (error) {
        // The host did not answer: not a verdict, and not said as one.
        row = { outcome: 'unanswered', sentence: `Could not be checked. ${describeError(error)}` };
      }
      if (!alive.current) return;
      found[each.id] = row;
      setChecks({ ...found });
      setProgress({ done: index + 1, total: list.length });
    }
    setProgress(null);
    setFinished(true);
    announce(summariseRecheck(list.map((each) => found[each.id]?.outcome ?? 'unanswered')));
  };

  // The summary is read off the rows still listed, so a code deleted after the check leaves the
  // count with it: the summary and the lines under it are two readings of one fact (§2).
  const outcomes =
    list?.flatMap((each) => {
      const check = checks[each.id];
      return check === undefined ? [] : [check.outcome];
    }) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-fg">Library</h1>
          <p className="mt-1 text-body text-fg-secondary">
            The codes you kept. Each one is drawn again from its own fields, and verified again when
            you open it.
          </p>
        </div>
        <Button
          className="shrink-0"
          disabled={list === undefined || list.length === 0 || running}
          onClick={() => void checkAll()}
        >
          Check all again
        </Button>
      </header>

      {/* Shown from the moment the check starts: a bar at zero is the truth about a check that
          has just begun (DESIGN_SYSTEM §8). */}
      {progress !== null && (
        <div className="flex flex-col gap-1">
          <ProgressBar label="Checking the library" value={progress.done} max={progress.total} />
          <p className="text-caption text-fg-secondary tabular-nums">
            {`${progress.done} of ${progress.total}`}
          </p>
        </div>
      )}

      {finished && !running && outcomes.length > 0 && (
        <InfoBar severity={recheckTone(outcomes)} title={summariseRecheck(outcomes)} />
      )}

      {codes.isError && (
        <InfoBar severity="danger" title="The saved codes could not be listed">
          {describeError(codes.error)}
        </InfoBar>
      )}

      {codes.isPending && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <div className="h-28 animate-pulse rounded-xl bg-card-hover" />
          <div className="h-28 animate-pulse rounded-xl bg-card-hover" />
        </div>
      )}

      {codes.data?.length === 0 && (
        <EmptyState
          icon={<Library24Regular />}
          title="Nothing saved yet"
          description="A verified code can be saved from Create."
        />
      )}

      {codes.data !== undefined && codes.data.length > 0 && (
        <ul aria-label="Saved codes" className="flex flex-col gap-3">
          {codes.data.map((saved) => (
            <li key={saved.id}>
              <Row summary={saved} onOpen={onOpen} check={checks[saved.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One saved code.
 *
 * The row asks for the code in full because that is what a preview is made of — the summary the
 * list returns is a name and a date, and a picture of a code cannot be made from either. While
 * the fields are on their way the row is still nameable and its name can still be changed;
 * only Open waits, because opening a code needs the code.
 */
function Row({
  summary,
  onOpen,
  check,
}: {
  summary: SavedCodeSummary;
  onOpen: (saved: SavedCode) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** What the library's check said about this code, once it has been checked. */
  check: RowCheck | undefined;
}) {
  const code = useCode(summary.id);
  const bytes = useLogoDataUrl(summary.logoId);
  const { mutateAsync: rename, isPending: renaming } = useRenameCode();
  const { mutateAsync: forget, isPending: deleting } = useDeleteCode();

  const [typed, setTyped] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const saved = code.data;
  // The logo's bytes, when the row has a logo and they have arrived. `null` covers both "no
  // logo" and "not yet", because both draw the same figure: the code without an overlay.
  const logoBytes = bytes.data ?? null;
  const drawn = useMemo(() => (saved === undefined ? null : rebuild(saved)), [saved]);

  const open = async () => {
    if (saved === undefined) return;
    setProblem(null);
    setOpening(true);
    const answer = await onOpen(saved);
    setOpening(false);
    if (answer.ok) {
      announce(`${saved.name} is open in Create; it is being checked again.`);
    } else {
      setProblem(answer.reason);
    }
  };

  const commit = async () => {
    if (typed === null) return;
    const checked = checkName(typed);
    if (!checked.ok) {
      setProblem(checked.reason);
      return;
    }
    setProblem(null);
    try {
      await rename({ id: summary.id, name: checked.name });
      setTyped(null);
      announce(`Renamed to ${checked.name}.`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const remove = async () => {
    setProblem(null);
    try {
      await forget(summary.id);
      setConfirming(false);
      announce(`${summary.name} is no longer in the library.`);
    } catch (error) {
      setConfirming(false);
      setProblem(describeError(error));
    }
  };

  return (
    <section className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card">
      <div className="flex items-start gap-4">
        {/* The code itself, drawn now from the stored fields — the same figure the Create
            screen shows, at the size a row can spare. */}
        <div className="w-24 shrink-0">
          {drawn !== null && drawn.ok ? (
            <CodePreview
              name={drawn.name}
              svg={drawn.svg}
              overlay={
                logoBytes !== null && drawn.box !== null
                  ? { dataUrl: logoBytes, box: drawn.box, side: drawn.side }
                  : undefined
              }
            />
          ) : (
            <div
              className={[
                'grid h-24 place-items-center rounded-xl border border-stroke-subtle',
                'bg-card px-2 text-center text-caption text-fg-tertiary shadow-card',
                drawn === null ? 'animate-pulse' : '',
              ].join(' ')}
            >
              {drawn === null ? '' : 'No code'}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-body-lg font-semibold text-fg">{summary.name}</p>
          <p className="text-caption text-fg-secondary">
            {PAYLOAD_LABELS[summary.kind]} · saved {day(summary.createdAt)}
          </p>
          {/* Why there is no picture, in the domain's own words — never an empty square. */}
          {drawn !== null && !drawn.ok && (
            <p className="text-caption text-fg-secondary">{drawn.reason}</p>
          )}
          {code.isError && (
            <p className="text-caption text-fg-secondary">
              This code could not be read. {describeError(code.error)}
            </p>
          )}
          {/* The check's verdict on this code, in the domain's sentence. The mark beside it is
              decoration: the words say the whole thing, so no colour has to be seen (§2). */}
          {check !== undefined && (
            <p className="flex items-center gap-2 text-caption text-fg-secondary">
              <span aria-hidden="true" className={`shrink-0 ${CHECK_MARK[check.outcome].tone}`}>
                {CHECK_MARK[check.outcome].icon}
              </span>
              {check.sentence}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            aria-label={`Open ${summary.name}`}
            disabled={saved === undefined || opening || deleting}
            onClick={() => void open()}
          >
            Open
          </Button>
          <Button
            appearance="subtle"
            aria-label={`Rename ${summary.name}`}
            disabled={deleting}
            onClick={() => setTyped(summary.name)}
          >
            Rename
          </Button>
          <Button
            appearance="subtle"
            aria-label={`Delete ${summary.name}`}
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Renaming happens where the name is, not in a dialog: it is a correction, and a dialog
          for a correction is a ceremony. */}
      {typed !== null && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Name</span>
            <Input
              aria-label="Name"
              value={typed}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commit();
                if (event.key === 'Escape') setTyped(null);
              }}
            />
          </label>
          <Button appearance="accent" disabled={renaming} onClick={() => void commit()}>
            Save
          </Button>
          <Button
            disabled={renaming}
            onClick={() => {
              setTyped(null);
              setProblem(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {problem !== null && (
        <div className="mt-3">
          <InfoBar severity="danger" title="Nothing was changed">
            {problem}
          </InfoBar>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Delete ${summary.name}`}
        confirmLabel="Delete"
        danger
        pending={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      >
        This code is forgotten and cannot be opened again. Files you have already exported are not
        affected.
      </ConfirmDialog>
    </section>
  );
}
