import {
  ArrowDownload20Regular,
  Call20Regular,
  Chat20Regular,
  ContactCard20Regular,
  Link20Regular,
  Location20Regular,
  Mail20Regular,
  QrCode24Regular,
  TextDescription20Regular,
  Wifi120Regular,
} from '@fluentui/react-icons';
import { save } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { VerificationReport } from '@/data/codes';
import { describeError, errorKind } from '@/data/errors';
import { useExportPng, useVerifyCode } from '@/data/hooks';
import type { LogoPlacement } from '@/data/logos';
import { NOMINAL_PRINT_MM, densityAdvice, densityWarning } from '@/domain/density';
import { describeCode, gateState } from '@/domain/describe';
import { centredLogoBox } from '@/domain/logo';
import {
  buildPayload,
  emptyForm,
  PAYLOAD_KINDS,
  PAYLOAD_LABELS,
  type PayloadForm,
  type PayloadKind,
} from '@/domain/payload';
import { encodeText, type Ecl } from '@/domain/qr/encode';
import { DEFAULT_STYLE, renderScene } from '@/domain/scene';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CodePreview } from '@/ui/CodePreview';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { ScanGateStatus } from '@/ui/ScanGateStatus';
import { TabStrip } from '@/ui/TabStrip';

import { PayloadFields } from './forms/PayloadFields';
import { LogoCard, type ChosenLogo } from './LogoCard';

/**
 * Create: what a person wants the code to do becomes a code, and the code is
 * proved before it can leave.
 *
 * The two halves of the screen are the two halves of the promise. On the left a
 * person says what scanning should do — a link, a message, a network — and on
 * the right they see what it will look like on paper, and what an independent
 * decoder made of it. The export button is not a third thing: it is whatever
 * the scan gate says it is.
 *
 * The kind is chosen at the top and the form below follows it. Nothing on this
 * screen knows the format of anything: the domain builds the payload, words the
 * summary and words the refusal, so the sentence a person reads and the bytes
 * the code carries stay two readings of one fact.
 */

/** Fixed in F0; the printed size becomes an input in F7 (spec §2.5). */
const PIXEL_SIZE = 1024;

/**
 * The error-correction level. `M` is the ordinary choice for a code with
 * nothing in the middle of it; a code with a logo in the middle of it is
 * encoded at `H`, the highest, because something is about to cover modules that
 * the decoder still has to be able to do without (spec §2.4). The choice is
 * automatic and only upward — a person is never asked to trade away the thing
 * that makes their code survive the logo.
 */
const ECL: Ecl = 'M';
const ECL_WITH_LOGO: Ecl = 'H';

/**
 * Long enough that a decoder is not asked about every keystroke, short enough
 * that the answer arrives while the person is still looking at the code.
 */
const DEBOUNCE_MS = 300;

/** One glyph per kind, beside its word — never instead of it (DESIGN_SYSTEM §5). */
const KIND_ICON: Record<PayloadKind, ReactNode> = {
  link: <Link20Regular />,
  text: <TextDescription20Regular />,
  email: <Mail20Regular />,
  phone: <Call20Regular />,
  sms: <Chat20Regular />,
  wifi: <Wifi120Regular />,
  geo: <Location20Regular />,
  contact: <ContactCard20Regular />,
};

/** What a phone does with this kind, in one line, above the fields. */
const KIND_NOTE: Record<PayloadKind, string> = {
  link: 'Web addresses in this version: http and https.',
  text: 'Plain text, shown by the camera exactly as it was typed.',
  email: 'Opens a new message. The subject and the body are optional.',
  phone: 'Offers to call the number. Digits, with an optional leading +.',
  sms: 'Opens a new text message to this number, already written.',
  wifi: 'Joins the network when a phone reads the code.',
  geo: 'Opens the map at these coordinates, in decimal degrees.',
  contact: "Adds the person to the phone's contacts when it reads the code.",
};

/**
 * What to type, for the kinds where "the form" is not the word for it. A prompt
 * for a form nobody has filled in yet is the first thing read on the right-hand
 * side, and it names the thing on the left in the same words that side uses.
 */
const EMPTY_PROMPT: Partial<Record<PayloadKind, string>> = {
  link: 'Type a link to see its code',
  contact: 'Fill in the card to see its code',
};

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
  key: string;
  report: VerificationReport | null;
  /** Set when the decoder could not be asked at all — not a verdict. */
  failure: string | null;
}

/** The outcome of an export, and the code it wrote. */
interface Written {
  key: string;
  tone: 'success' | 'danger';
  text: string;
}

/**
 * What was verified, as one string.
 *
 * The SVG alone is not the artefact any more: the scene carries the plate but
 * not the logo, so two different logos in the same place produce the same SVG
 * and would make a verdict about one of them look like a verdict about the
 * other. The identity the window compares is therefore the code *and* what is
 * being drawn into the middle of it.
 */
function artefactKey(svg: string, placement: LogoPlacement | null): string {
  const logo =
    placement === null
      ? 'no logo'
      : `${placement.id}@${placement.x},${placement.y},${placement.width}x${placement.height}`;
  return `${logo}\n${svg}`;
}

/**
 * Whether nothing has been filled in yet — the draft is still the empty one the
 * shell made. A reason for a field nobody has typed into is a telling-off
 * rather than help, so the line under the form stays neutral until there is
 * something to be wrong about.
 */
function untouched(form: PayloadForm): boolean {
  const pristine = new Map<string, unknown>(Object.entries(emptyForm(form.kind)));
  return Object.entries(form).every(([field, value]) => pristine.get(field) === value);
}

interface CreatePageProps {
  /** The kind being edited. It lives in the shell, which keeps one draft per kind. */
  kind: PayloadKind;
  onKind: (kind: PayloadKind) => void;
  form: PayloadForm;
  onForm: (form: PayloadForm) => void;
  /**
   * The logo, which belongs to the editor rather than to a kind: it lives in
   * the shell and survives a change of kind, because a person choosing their
   * mark chose it for their codes, not for the link.
   */
  logo: ChosenLogo | null;
  onLogo: (logo: ChosenLogo | null) => void;
}

export function CreatePage({ kind, onKind, form, onForm, logo, onLogo }: CreatePageProps) {
  const result = useMemo(() => buildPayload(form), [form]);
  const payload = result.ok ? result.payload : null;

  // The scene is the code. The same string is what the preview draws, what the
  // decoder is asked about and what the export writes — one artefact, checked
  // once. A preview rendered from anything else would be a picture of a
  // different code.
  const scene = useMemo(() => {
    if (!result.ok) return { svg: null, side: null, box: null, failure: null };
    try {
      const matrix = encodeText(result.payload, logo === null ? ECL : ECL_WITH_LOGO);
      // The domain decides where the logo goes; the screen and the host both
      // read those same module coordinates, so the picture on the glass and the
      // pixels the decoder is given are one thing rendered twice.
      const box = logo === null ? null : centredLogoBox(matrix, DEFAULT_STYLE.quietZone);
      const rendered = renderScene(
        matrix,
        DEFAULT_STYLE,
        describeCode(result.summary),
        logo !== null && box !== null
          ? { box, plate: logo.plate, padding: 1, colour: DEFAULT_STYLE.background }
          : undefined,
      );
      return { svg: rendered.svg, side: rendered.side, box, failure: null };
    } catch (error) {
      return {
        svg: null,
        side: null,
        box: null,
        failure: error instanceof Error ? error.message : 'This could not be made into a code.',
      };
    }
  }, [result, logo]);
  const svg = scene.svg;
  const box = scene.box;

  // The placement, in the shape the host takes. It is derived from the scene,
  // so it changes exactly when the code does and never between.
  const placement = useMemo<LogoPlacement | null>(
    () => (logo === null || box === null ? null : { id: logo.info.id, ...box }),
    [logo, box],
  );
  const artefact = svg === null ? null : artefactKey(svg, placement);

  // How small the modules come out at the size this version prints at. It is
  // about the code on screen, not about the kind or the payload length, so it
  // is asked of the scene — and it is a warning, never a refusal: it says the
  // card may not scan at 25 mm, and the export button never hears about it.
  const density =
    scene.side === null
      ? null
      : densityWarning({ side: scene.side }, NOMINAL_PRINT_MM, densityAdvice(form));

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [written, setWritten] = useState<Written | null>(null);

  const { mutateAsync: verify } = useVerifyCode();
  const { mutateAsync: writePng, isPending: exporting } = useExportPng();

  // Only an answer about the code on screen is an answer at all; everything
  // else is derived from that, so nothing has to be reset when the payload
  // changes and nothing can be left over from the payload before it.
  const current = answer !== null && answer.key === artefact ? answer : null;
  const report = current?.report ?? null;
  const hostFailure = current?.failure ?? null;
  const inFlight = svg !== null && current === null;
  const message = written !== null && written.key === artefact ? written : null;

  /** Every accepted payload is verified, once the typing stops. */
  useEffect(() => {
    if (svg === null || payload === null || artefact === null) return;

    const timer = window.setTimeout(() => {
      verify({ svg, payload, pixelSize: PIXEL_SIZE, logo: placement })
        .then((next) => setAnswer({ key: artefact, report: next, failure: null }))
        .catch((error: unknown) =>
          // Not a verdict: the decoder never answered. The gate stays at "not
          // verified yet" and the reason is said separately, because the status
          // must never show a state that did not come back from a decoder.
          setAnswer({ key: artefact, report: null, failure: describeError(error) }),
        );
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [artefact, svg, payload, placement, verify]);

  // The gate owns the export button. Nothing else is allowed to enable it.
  const gate = gateState(report, inFlight);

  const exportPng = async () => {
    if (svg === null || payload === null || artefact === null) return;
    try {
      const path = await save({
        defaultPath: 'signatum.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (path === null) return;

      const done = await writePng({ svg, payload, pixelSize: PIXEL_SIZE, path, logo: placement });
      setWritten({
        key: artefact,
        tone: 'success',
        text: `Written to ${path} — verified by ${done.decoder}`,
      });
      announce(`The code was written, verified by ${done.decoder}`);
    } catch (error) {
      // `refused` is not a failure of the export: it is the gate doing its job,
      // and the host's message is already the reason.
      const text = describeError(error);
      setWritten({ key: artefact, tone: 'danger', text });
      if (errorKind(error) === 'refused') announce(`Nothing was written. ${text}`);
    }
  };

  // The domain words the empty case too ("Type a link to see its code."), and
  // that is a prompt rather than a rejection: it is not coloured like one.
  const pristine = untouched(form);
  const helper = result.ok ? result.summary : result.reason;
  const invalid = result.ok ? undefined : result.field;
  // What the accepted payload could not carry — MECARD has nowhere to put a
  // title. The builder words it; the form only shows it, beside the control
  // that caused it.
  const note =
    result.ok && 'note' in result && typeof result.note === 'string' ? result.note : undefined;

  const tabs = PAYLOAD_KINDS.map((candidate) => ({
    id: candidate,
    label: PAYLOAD_LABELS[candidate],
    icon: KIND_ICON[candidate],
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Create</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Say what the code should do. Nothing is exported until a decoder reads the code back as
          exactly that.
        </p>
      </header>

      {/* The kind applies to the whole editor, so the strip spans both panes: inside the
          left pane, the tabs ran under the preview and the last one disappeared. */}
      <TabStrip
        label="What the code does"
        tabs={tabs}
        active={kind}
        onSelect={(id) => {
          // The strip speaks in strings; only one of the kinds is an answer.
          const next = PAYLOAD_KINDS.find((candidate) => candidate === id);
          if (next !== undefined) onKind(next);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title={PAYLOAD_LABELS[kind]} description={KIND_NOTE[kind]}>
            <div className="flex flex-col gap-3">
              <PayloadFields form={form} onChange={onForm} invalid={invalid} note={note} />
            </div>
            <p
              aria-live="polite"
              className={`mt-3 min-h-5 text-body ${result.ok || pristine ? 'text-fg-secondary' : 'text-danger'}`}
            >
              {helper}
            </p>
          </Card>

          {scene.failure !== null && (
            <InfoBar severity="caution" title="This cannot be made into a code">
              {scene.failure}
            </InfoBar>
          )}

          <LogoCard logo={logo} onLogo={onLogo} />
        </div>

        <div className="flex flex-col gap-4">
          <CodePreview
            name={result.ok ? describeCode(result.summary) : 'No code yet'}
            svg={svg}
            overlay={
              logo !== null && logo.info.dataUrl !== null && box !== null && scene.side !== null
                ? { dataUrl: logo.info.dataUrl, box, side: scene.side }
                : undefined
            }
            caption={
              payload !== null ? (
                <span data-selectable className="font-mono break-all">
                  {payload}
                </span>
              ) : undefined
            }
            placeholder={
              <EmptyState
                icon={<QrCode24Regular />}
                title={EMPTY_PROMPT[kind] ?? 'Fill in the form to see its code'}
                description="The code appears as you type, in the colours it will be printed in."
              />
            }
          />

          {density !== null && (
            <InfoBar severity="caution" title="Dense code">
              {density}
            </InfoBar>
          )}

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
