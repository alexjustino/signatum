import { Library24Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useCode, useCodes, useDeleteCode, useLogoDataUrl, useRenameCode } from '@/data/hooks';
import type { SavedCode, SavedCodeSummary } from '@/data/library';
import { describeCode } from '@/domain/describe';
import { checkName, reopens } from '@/domain/library';
import type { LogoBox } from '@/domain/logo';
import { buildPayload, PAYLOAD_LABELS } from '@/domain/payload';
import { checkPrintSize } from '@/domain/size';
import { checkContrast } from '@/domain/style';
import { planFor, sceneFor } from '@/features/create/plan';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { CodePreview } from '@/ui/CodePreview';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

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

/** What one row shows of its code: the scene, or why there is none. */
type Preview =
  | { svg: string; side: number; box: LogoBox | null; name: string; reason: null }
  | { svg: null; side: null; box: null; name: null; reason: string };

/**
 * The code a row draws, rebuilt from the stored fields.
 *
 * Every refusal on the way is a sentence rather than an empty box: a payload that cannot be
 * built, a plan that will not carry the logo, a pair of colours no camera reads, a size nothing
 * is printed at. They are the domain's words, the same ones the Create screen shows.
 */
function preview(saved: SavedCode): Preview {
  const none = (reason: string): Preview => ({
    svg: null,
    side: null,
    box: null,
    name: null,
    reason,
  });

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

  return { svg: rendered.svg, side: rendered.side, box: plan.box, name, reason: null };
}

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Library</h1>
        <p className="mt-1 text-body text-fg-secondary">
          The codes you kept. Each one is drawn again from its own fields, and verified again when
          you open it.
        </p>
      </header>

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
              <Row summary={saved} onOpen={onOpen} />
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
}: {
  summary: SavedCodeSummary;
  onOpen: (saved: SavedCode) => Promise<{ ok: true } | { ok: false; reason: string }>;
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
  const drawn = useMemo(() => (saved === undefined ? null : preview(saved)), [saved]);

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
          {drawn !== null && drawn.reason === null ? (
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
          {drawn !== null && drawn.reason !== null && (
            <p className="text-caption text-fg-secondary">{drawn.reason}</p>
          )}
          {code.isError && (
            <p className="text-caption text-fg-secondary">
              This code could not be read. {describeError(code.error)}
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
