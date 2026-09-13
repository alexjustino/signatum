import { DocumentTable24Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  BATCH_FORMAT_LABELS,
  BATCH_FORMATS,
  onBatchProgress,
  type BatchFormat,
  type BatchReport,
  type BatchRow,
} from '@/data/batch';
import { describeError } from '@/data/errors';
import { useCancelBatch, useReadTextFile, useRunBatch, useWriteBatchReport } from '@/data/hooks';
import {
  parseCsv,
  planBatch,
  reportCsv,
  type BatchLook,
  type BatchPlan,
  type PlannedRow,
  type RowResult,
} from '@/domain/batch';
import { logoFraction } from '@/domain/logo';
import type { Style } from '@/domain/scene';
import { pixelsFor, type PrintSize } from '@/domain/size';
import type { ChosenLogo } from '@/features/create/LogoCard';
import type { EclFloor } from '@/features/create/LookCard';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { ProgressBar } from '@/ui/ProgressBar';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

/**
 * The batch (SPEC §2.8, F9): a CSV of links or contacts becomes one verified file per row.
 *
 * There is no second pipeline here. Every row is planned by the same domain the Create screen
 * uses — the payload built, the code planned, the scene rendered — with the look, the size and
 * the logo that are set on Create right now, because a batch of two hundred codes that do not
 * look like the one a person approved is two hundred files to throw away. The screen says so in
 * a sentence rather than making anybody deduce it.
 *
 * The plan is shown before anything is written, and it is honest about what it cannot do: a row
 * that will not become a code is listed with its line number and the domain's own reason, and
 * the rest of the batch runs all the same. Nothing is written until a folder is chosen, nothing
 * is written outside it, and the report the run leaves behind names every row that did not make
 * it — which is what makes a total something a person can check instead of trust.
 */

/** How long the typing stops before the rows are planned. Two hundred rows is real work. */
const PLAN_MS = 300;

/** How many rows the plan table shows. A table nobody scrolls is not a preview, it is a wall. */
const SHOWN = 50;

/** What the two lines of the header offer, as an example rather than an explanation. */
const PLACEHOLDER = 'name,url\nAna Souza,https://example.com/ana';

/** `1 row`, `200 rows` — a count that reads as English at both ends. */
function rows(n: number): string {
  return `${n} ${n === 1 ? 'row' : 'rows'}`;
}

/** What one run left behind, once the last row is done. */
interface Outcome {
  report: BatchReport;
  /** The results with the names the plan gave them — the report CSV is written from these. */
  results: RowResult[];
  folder: string;
  reportPath: string | null;
  /** Set when the codes were written and the report was not: a run is not lost by its receipt. */
  reportProblem: string | null;
  cancelled: boolean;
}

export function BatchPage({
  style,
  size,
  eclFloor,
  logo,
  rows: text,
  onRows: setText,
}: {
  style: Style;
  size: PrintSize;
  eclFloor: EclFloor | undefined;
  logo: ChosenLogo | null;
  /**
   * The rows, however they arrived: a file the host read, or a paste from a spreadsheet. One
   * text, one plan — a screen with two sources of rows and two plans is a screen where the
   * button runs the one you are not looking at. The shell holds the text, because a person
   * goes to Create to change the look and comes back, and two hundred pasted rows must be
   * where they were left.
   */
  rows: string;
  onRows: (text: string) => void;
}) {
  const [settled, setSettled] = useState(text);
  const [format, setFormat] = useState<BatchFormat>('png');
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [runProblem, setRunProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const { mutateAsync: readFile, isPending: reading } = useReadTextFile();
  const { mutateAsync: start, isPending: running } = useRunBatch();
  const { mutateAsync: stopBatch, isPending: cancelling } = useCancelBatch();
  const { mutateAsync: writeReport } = useWriteBatchReport();

  // Whether Cancel was pressed during the run being awaited. A ref rather than the state,
  // because the answer is read inside the promise that started before it was pressed.
  const cancelled = useRef(false);

  /**
   * The counter, while the host is writing.
   *
   * Subscribed once for the life of the screen and unsubscribed when it goes, rather than per
   * run: `listen` resolves asynchronously, so a subscription tied to a run that has already
   * finished is a handler that arrives after the thing it was watching. The screen ignores the
   * events when no batch is running — there are none.
   */
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void onBatchProgress((update) => {
      setProgress({ done: update.done, total: update.total });
    })
      .then((unlisten) => {
        if (gone) unlisten();
        else stop = unlisten;
      })
      // No host, no events: the screen still plans, it only cannot count.
      .catch(() => undefined);
    return () => {
      gone = true;
      if (stop !== null) stop();
    };
  }, []);

  // The rows are planned when the typing stops, not on every keystroke: planning is the whole
  // Create pipeline, once per row.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(text), PLAN_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const fraction = logo === null ? undefined : logoFraction(logo.size);
  const look = useMemo<BatchLook>(
    () => ({
      style,
      size,
      ...(eclFloor === undefined ? {} : { eclFloor }),
      logo:
        logo === null
          ? null
          : {
              id: logo.info.id,
              plate: logo.plate,
              ...(fraction === undefined ? {} : { fraction }),
            },
    }),
    [style, size, eclFloor, logo, fraction],
  );

  const planned = useMemo(
    () => (settled.trim() === '' ? null : planBatch(parseCsv(settled), look)),
    [settled, look],
  );

  // Two answers from the domain: a header it could not read at all, or a plan — which may still
  // be a plan with problems in it.
  const unreadable = planned !== null && 'ok' in planned ? planned.reason : null;
  const plan: BatchPlan | null = planned !== null && !('ok' in planned) ? planned : null;

  const planning = text !== settled;
  const pixels = pixelsFor(size);
  const plannedCount = plan === null ? 0 : plan.rows.length;
  const runnable = plannedCount > 0;

  /**
   * Choose a CSV. The host reads it — the interface never opens a file — and what comes back
   * lands in the same box a paste would have.
   */
  const choose = async () => {
    setReadProblem(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Rows', extensions: ['csv', 'txt'] }],
      });
      if (typeof path !== 'string') return;
      const content = await readFile(path);
      setText(content);
      // The plan is what a person came for; waiting 300 ms to hear about it is waiting.
      setSettled(content);
      announce('The rows were read; the plan is below.');
    } catch (error) {
      setReadProblem(describeError(error));
    }
  };

  /** One planned row as the host takes it: drawn, named, and placed. */
  const wire = (row: PlannedRow): BatchRow => ({
    line: row.line,
    file: row.file,
    svg: row.scene.svg,
    payload: row.payload,
    logo: logo !== null && row.plan.box !== null ? { id: logo.info.id, ...row.plan.box } : null,
    pixelSize: row.pixelSize,
  });

  /**
   * Choose a folder and run it.
   *
   * The folder is chosen before anything happens, and it is the only place anything is written.
   * The report is composed here, by the domain, and handed to the host as a string: a receipt
   * for a run is written where the run went, and a spreadsheet never evaluates a cell of it.
   */
  const run = async () => {
    if (plan === null || plan.rows.length === 0) return;
    setRunProblem(null);
    let folder: string | string[] | null;
    try {
      folder = await open({ directory: true, multiple: false });
    } catch (error) {
      setRunProblem(describeError(error));
      return;
    }
    if (typeof folder !== 'string') return;

    const chosen = folder;
    cancelled.current = false;
    setOutcome(null);
    setProgress({ done: 0, total: plan.rows.length });
    try {
      const report = await start({
        folder: chosen,
        format,
        dpi: size.dpi,
        rows: plan.rows.map(wire),
      });

      // The host answers by line; the names are the plan's. The report carries both, so a row in
      // the CSV can be found by the name a person gave it and not only by its number.
      const names = new Map(plan.rows.map((row) => [row.line, row.name]));
      const results: RowResult[] = report.results.map((each) => ({
        line: each.line,
        name: names.get(each.line) ?? '',
        file: each.file,
        status: each.status,
        reason: each.reason,
      }));

      let reportPath: string | null = null;
      let reportProblem: string | null = null;
      try {
        reportPath = await writeReport({
          folder: chosen,
          csv: reportCsv(results, plan.problems),
        });
      } catch (error) {
        reportProblem = describeError(error);
      }

      setOutcome({
        report,
        results,
        folder: chosen,
        reportPath,
        reportProblem,
        cancelled: cancelled.current,
      });
      announce(
        `The batch finished — ${report.written} written, ${report.refused} refused, ` +
          `${report.failed} failed.`,
      );
    } catch (error) {
      setRunProblem(describeError(error));
    } finally {
      setProgress(null);
    }
  };

  /** Stop after the row being written. The rest of the batch comes back as skipped. */
  const stop = async () => {
    try {
      await stopBatch();
      // Marked only once the host has taken it: a cancel that failed leaves a batch that is
      // still running, and a report that claimed otherwise would be the screen inventing an
      // outcome.
      cancelled.current = true;
      announce('The batch stops after the row being written.');
    } catch (error) {
      setRunProblem(describeError(error));
    }
  };

  const shown = plan === null ? [] : plan.rows.slice(0, SHOWN);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Batch</h1>
        <p className="mt-1 text-body text-fg-secondary">
          A CSV of links or contacts becomes one verified file per row, in a folder you choose, with
          a report of every row that could not be made.
        </p>
      </header>

      <Card
        title="Rows"
        description="Choose a CSV, or paste the rows from a spreadsheet."
        actions={
          <Button disabled={reading || running} onClick={() => void choose()}>
            Choose a CSV…
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Rows</span>
            <TextArea
              aria-label="Rows"
              className="min-h-40 font-mono text-caption"
              spellCheck={false}
              autoComplete="off"
              placeholder={PLACEHOLDER}
              value={text}
              // Held while the host is writing: the rows on screen and the rows being written
              // have to be the same rows, or the table is a description of another batch.
              disabled={running}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p className="text-caption text-fg-tertiary">
            The first line names the columns: <code>url</code> for links, or <code>given_name</code>
            , <code>family_name</code>, <code>email</code>, <code>phone</code>,{' '}
            <code>organisation</code> and the rest for contacts. A <code>name</code> column, when
            there is one, names the file.
          </p>
          <p className="text-caption text-fg-tertiary">
            Using the current look, size and logo from Create.
          </p>
          {readProblem !== null && (
            <InfoBar severity="danger" title="The file could not be read">
              {readProblem}
            </InfoBar>
          )}
        </div>
      </Card>

      <Card title="Plan" description="What these rows become, before anything is written.">
        <div className="flex flex-col gap-3">
          {plan === null && unreadable === null && (
            <EmptyState
              icon={<DocumentTable24Regular />}
              title="Nothing to plan yet"
              description="Choose a CSV file, or paste rows above, and the plan appears here."
            />
          )}

          {unreadable !== null && (
            <InfoBar severity="caution" title="These rows cannot be read">
              {unreadable}
            </InfoBar>
          )}

          {plan !== null && (
            <>
              <p aria-live="polite" className="text-body text-fg">
                {planning
                  ? 'Working out the plan…'
                  : plan.problems.length === 0
                    ? `${rows(plan.rows.length)} can be made.`
                    : `${plan.rows.length} of ${rows(plan.rows.length + plan.problems.length)} can be made.`}
              </p>

              {/* Fixed layout on purpose: a name or a file stem is as long as somebody made it,
                  and a table that widens for one of them is a table with a scrollbar nobody can
                  reach by keyboard. The cells truncate; the whole list is in the report. */}
              {plan.rows.length > 0 && (
                <table aria-label="Rows" className="w-full table-fixed text-caption">
                  <thead>
                    <tr className="border-b border-stroke-subtle text-left text-fg-tertiary">
                      <th scope="col" className="w-14 py-1 pr-3 font-semibold">
                        Line
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        Name
                      </th>
                      <th scope="col" className="py-1 pr-3 font-semibold">
                        File
                      </th>
                      <th scope="col" className="w-20 py-1 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.line} className="border-b border-stroke-subtle/60">
                        <td className="py-1 pr-3 text-fg-secondary tabular-nums">{row.line}</td>
                        <td className="truncate py-1 pr-3 text-fg">{row.name}</td>
                        <td className="truncate py-1 pr-3 font-mono text-fg-secondary">
                          {`${row.file}.${format}`}
                        </td>
                        <td className="py-1 text-fg-secondary">Planned</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {plan.rows.length > SHOWN && (
                <p className="text-caption text-fg-tertiary">
                  {`First ${SHOWN} of ${plan.rows.length} shown`}
                </p>
              )}

              {plan.problems.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-caption font-semibold text-fg-secondary">
                    {`${rows(plan.problems.length)} cannot be made`}
                  </p>
                  <ul
                    aria-label="Rows that cannot be made"
                    className="flex flex-col gap-1 text-caption text-fg-secondary"
                  >
                    {plan.problems.map((problem, index) => (
                      <li key={`${problem.line}-${index}`}>
                        <span className="font-semibold text-fg">{`Line ${problem.line}: `}</span>
                        {problem.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card title="Run" description="Every row through the same gate a single export passes.">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Files</span>
            <Select
              aria-label="Files"
              value={format}
              disabled={running}
              onChange={(event) => {
                const chosen = BATCH_FORMATS.find((each) => each === event.target.value);
                setFormat(chosen ?? 'png');
              }}
            >
              {BATCH_FORMATS.map((each) => (
                <option key={each} value={each}>
                  {BATCH_FORMAT_LABELS[each]}
                </option>
              ))}
            </Select>
          </label>

          {/* The resolution is the Size card's, not a second copy of it: one look for the code
              on screen and the two hundred beside it (DESIGN_SYSTEM §2, two readings agree). */}
          <p className="text-caption text-fg-secondary">
            {`${pixels} × ${pixels} px · ${size.dpi} dpi · set on Create`}
          </p>
          <p className="text-caption text-fg-secondary">
            Files already in the folder are never replaced; a row that would is reported instead.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button appearance="accent" disabled={!runnable || running} onClick={() => void run()}>
              Choose a folder and run…
            </Button>
            {running && (
              <Button disabled={cancelling} onClick={() => void stop()}>
                Cancel
              </Button>
            )}
          </div>

          {/* Shown while the host is writing, whether or not an event has arrived yet: a bar at
              zero is the truth about a batch that has just started, and Cancel must be there
              from the first row — it is gated on the run, never on the counter. */}
          {running && (
            <div className="flex flex-col gap-1">
              <ProgressBar
                label="Batch progress"
                value={progress?.done ?? 0}
                max={progress?.total ?? plannedCount}
              />
              <p className="text-caption text-fg-secondary tabular-nums">
                {`${progress?.done ?? 0} of ${progress?.total ?? plannedCount}`}
              </p>
            </div>
          )}

          {runProblem !== null && (
            <InfoBar severity="danger" title="The batch did not run">
              {runProblem}
            </InfoBar>
          )}

          {outcome !== null && <Report outcome={outcome} />}
        </div>
      </Card>
    </div>
  );
}

/**
 * What the run left behind: the counts, where the files went, where the receipt went, and every
 * row that did not become a file.
 *
 * The list of rows sits outside the message rather than inside it, because the message is a live
 * region: a screen reader should say "197 written, 2 refused, 1 failed", not recite two hundred
 * lines somebody is about to read at their own pace (DESIGN_SYSTEM §7).
 */
function Report({ outcome }: { outcome: Outcome }) {
  const { report, results, folder, reportPath, reportProblem, cancelled } = outcome;
  const attempted = report.written + report.refused + report.failed;
  const unwritten = results.filter((each) => each.status !== 'written');
  const counts =
    `${report.written} written · ${report.refused} refused · ${report.failed} failed` +
    (report.skipped > 0 ? ` · ${report.skipped} skipped` : '');

  return (
    <div className="flex flex-col gap-2">
      <InfoBar
        severity={cancelled || report.refused + report.failed > 0 ? 'caution' : 'success'}
        title={counts}
      >
        <div className="flex flex-col gap-1">
          {cancelled && <p>{`Cancelled after ${rows(attempted)}.`}</p>}
          <p>
            <span data-selectable className="font-mono break-all">
              {folder}
            </span>
          </p>
          {reportPath !== null ? (
            <p>
              Report:{' '}
              <span data-selectable className="font-mono break-all">
                {reportPath}
              </span>
            </p>
          ) : (
            <p>{reportProblem ?? 'The report was not written.'}</p>
          )}
        </div>
      </InfoBar>

      {unwritten.length > 0 && (
        <ul
          aria-label="Rows not written"
          className="flex flex-col gap-1 text-caption text-fg-secondary"
        >
          {unwritten.map((each) => (
            <li key={each.line}>
              <span className="font-semibold text-fg">{`Line ${each.line}: `}</span>
              {each.reason.length > 0 ? each.reason : STATUS_WORDS[each.status]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a status means when the host had nothing to add to it. */
const STATUS_WORDS: Record<RowResult['status'], string> = {
  written: 'Written.',
  refused: 'Refused by the gate.',
  failed: 'It could not be written.',
  skipped: 'Not reached — the batch was cancelled.',
};
