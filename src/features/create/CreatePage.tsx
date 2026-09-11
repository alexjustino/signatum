import { ArrowDownload20Regular, QrCode24Regular } from '@fluentui/react-icons';
import { save } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useState } from 'react';

import type { VerificationReport } from '@/data/codes';
import { describeError, errorKind } from '@/data/errors';
import { useExportPng, useVerifyCode } from '@/data/hooks';
import { describeCode, gateState } from '@/domain/describe';
import { describeLink, parseLink } from '@/domain/payload/link';
import { encodeText, type Ecl } from '@/domain/qr/encode';
import { DEFAULT_STYLE, renderScene } from '@/domain/scene';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CodePreview } from '@/ui/CodePreview';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { ScanGateStatus } from '@/ui/ScanGateStatus';

/**
 * Create: a link becomes a code, and the code is proved before it can leave.
 *
 * The two halves of the screen are the two halves of the promise. On the left a
 * person says what the code should do; on the right they see what it will look
 * like on paper, and what an independent decoder made of it. The export button
 * is not a third thing — it is whatever the scan gate says it is.
 */

/** Fixed in F0; the printed size becomes an input in F7 (spec §2.5). */
const PIXEL_SIZE = 1024;

/**
 * The error-correction level. `M` is the ordinary choice for a code with
 * nothing in the middle of it; from F4 the level is chosen from the logo's
 * budget, and only upward.
 */
const ECL: Ecl = 'M';

/**
 * Long enough that a decoder is not asked about every keystroke, short enough
 * that the answer arrives while the person is still looking at the code.
 */
const DEBOUNCE_MS = 300;

/**
 * An answer, and the code it is an answer about.
 *
 * Carrying the artefact with the verdict is what makes a stale answer
 * impossible to show: an answer that arrives about a code the window has moved
 * on from does not match the code on screen, and is read as no answer at all. A
 * verdict shown beside a code it was not about is exactly the failure this gate
 * exists to prevent, so it is ruled out by the shape of the state rather than
 * by remembering to check.
 */
interface Answer {
  svg: string;
  report: VerificationReport | null;
  /** Set when the decoder could not be asked at all — not a verdict. */
  failure: string | null;
}

/** The outcome of an export, and the code it wrote. */
interface Written {
  svg: string;
  tone: 'success' | 'danger';
  text: string;
}

interface CreatePageProps {
  /** The link as typed. It lives in the shell so that a visit to Settings does not erase it. */
  draft: string;
  onDraft: (draft: string) => void;
}

export function CreatePage({ draft: input, onDraft: setInput }: CreatePageProps) {
  const link = useMemo(() => parseLink(input), [input]);
  const payload = link.ok ? link.url : null;

  // The scene is the code. The same string is what the preview draws, what the
  // decoder is asked about and what the export writes — one artefact, checked
  // once. A preview rendered from anything else would be a picture of a
  // different code.
  const scene = useMemo(() => {
    if (payload === null) return { svg: null, failure: null };
    try {
      return {
        svg: renderScene(encodeText(payload, ECL), DEFAULT_STYLE, describeCode(payload)).svg,
        failure: null,
      };
    } catch (error) {
      return {
        svg: null,
        failure:
          error instanceof Error ? error.message : 'This link could not be made into a code.',
      };
    }
  }, [payload]);
  const svg = scene.svg;

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [written, setWritten] = useState<Written | null>(null);

  const { mutateAsync: verify } = useVerifyCode();
  const { mutateAsync: writePng, isPending: exporting } = useExportPng();

  // Only an answer about the code on screen is an answer at all; everything
  // else is derived from that, so nothing has to be reset when the link
  // changes and nothing can be left over from the link before it.
  const current = answer !== null && answer.svg === svg ? answer : null;
  const report = current?.report ?? null;
  const hostFailure = current?.failure ?? null;
  const inFlight = svg !== null && current === null;
  const message = written !== null && written.svg === svg ? written : null;

  /** Every accepted link is verified, once the typing stops. */
  useEffect(() => {
    if (svg === null || payload === null) return;

    const timer = window.setTimeout(() => {
      verify({ svg, payload, pixelSize: PIXEL_SIZE })
        .then((next) => setAnswer({ svg, report: next, failure: null }))
        .catch((error: unknown) =>
          // Not a verdict: the decoder never answered. The gate stays at "not
          // verified yet" and the reason is said separately, because the status
          // must never show a state that did not come back from a decoder.
          setAnswer({ svg, report: null, failure: describeError(error) }),
        );
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [svg, payload, verify]);

  // The gate owns the export button. Nothing else is allowed to enable it.
  const gate = gateState(report, inFlight);

  const exportPng = async () => {
    if (svg === null || payload === null) return;
    try {
      const path = await save({
        defaultPath: 'signatum.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (path === null) return;

      const done = await writePng({ svg, payload, pixelSize: PIXEL_SIZE, path });
      setWritten({
        svg,
        tone: 'success',
        text: `Written to ${path} — verified by ${done.decoder}`,
      });
      announce(`The code was written, verified by ${done.decoder}`);
    } catch (error) {
      // `refused` is not a failure of the export: it is the gate doing its job,
      // and the host's message is already the reason.
      const text = describeError(error);
      setWritten({ svg, tone: 'danger', text });
      if (errorKind(error) === 'refused') announce(`Nothing was written. ${text}`);
    }
  };

  // The domain words the empty case too ("Type a link to see its code."), and
  // that is a prompt rather than a rejection: it is not coloured like one.
  const empty = input.trim() === '';
  const helper = link.ok ? describeLink(link.url) : link.reason;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Create</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Type a link. Nothing is exported until a decoder reads the code back as that link.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Link" description="Web addresses in this version: http and https.">
            <Input
              aria-label="Link"
              placeholder="https://"
              value={input}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
            />
            <p
              aria-live="polite"
              className={`mt-2 min-h-5 text-body ${link.ok || empty ? 'text-fg-secondary' : 'text-danger'}`}
            >
              {helper}
            </p>
          </Card>

          {scene.failure !== null && (
            <InfoBar severity="caution" title="This link cannot be made into a code">
              {scene.failure}
            </InfoBar>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <CodePreview
            name={payload === null ? 'No code yet' : describeCode(payload)}
            svg={svg}
            caption={
              link.ok ? (
                <span data-selectable className="font-mono break-all">
                  {link.url}
                </span>
              ) : undefined
            }
            placeholder={
              <EmptyState
                icon={<QrCode24Regular />}
                title="Type a link to see its code"
                description="The code appears as you type, in the colours it will be printed in."
              />
            }
          />

          <ScanGateStatus report={report} inFlight={inFlight} />

          {hostFailure !== null && (
            <InfoBar severity="danger" title="The decoder could not be asked">
              {hostFailure}
            </InfoBar>
          )}

          <div>
            <Button
              appearance="accent"
              icon={<ArrowDownload20Regular />}
              disabled={gate !== 'verified' || exporting}
              onClick={() => void exportPng()}
            >
              Export PNG…
            </Button>
          </div>

          {message !== null && (
            <InfoBar
              severity={message.tone === 'success' ? 'success' : 'danger'}
              title={message.tone === 'success' ? 'Exported' : 'Nothing was written'}
            >
              <span data-selectable className={message.tone === 'success' ? 'font-mono' : ''}>
                {message.text}
              </span>
            </InfoBar>
          )}
        </div>
      </div>
    </div>
  );
}
