import {
  ArrowDownload20Regular,
  Call20Regular,
  Chat20Regular,
  ContactCard20Regular,
  Copy20Regular,
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
import {
  useCopyPng,
  useExportPdf,
  useExportPng,
  useExportSvg,
  useScanMargin,
  useVerifyCode,
} from '@/data/hooks';
import type { LogoPlacement } from '@/data/logos';
import { densityAdvice, densityWarning } from '@/domain/density';
import { describeCode, gateState, type GateReport, type ScanVariant } from '@/domain/describe';
import { logoFraction } from '@/domain/logo';
import {
  buildPayload,
  emptyForm,
  PAYLOAD_KINDS,
  PAYLOAD_LABELS,
  type PayloadForm,
  type PayloadKind,
} from '@/domain/payload';
import { planCode, type Plan } from '@/domain/placement';
import type { Ecl } from '@/domain/qr/encode';
import { renderScene, type Style } from '@/domain/scene';
import { checkPrintSize, pixelsFor, sizedSvg, toMillimetres, type PrintSize } from '@/domain/size';
import { checkContrast } from '@/domain/style';
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
import { LookCard, type EclFloor } from './LookCard';
import { ScanMarginCard } from './ScanMarginCard';
import { SizeCard } from './SizeCard';

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

/**
 * How long after a verdict the scan margin is asked for.
 *
 * Long enough that a person still typing never pays for it, short enough that
 * the answer is there while they are still looking at the code that was just
 * verified. The margin never blocks an export (ADR-027).
 */
const MARGIN_MS = 400;

/**
 * The error-correction level for a code with nothing in the middle of it, when
 * nobody has asked for more. `M` is the ordinary choice.
 *
 * A code that carries a logo is not decided here at all: the placement engine
 * starts at `H`, the highest, because something is about to cover modules the
 * decoder still has to do without, and falls back to `Q` only when the content
 * will not fit at `H` (spec §2.4). What a person may choose in the Look card is
 * a *floor*, never a ceiling — the engine's own choice can only be raised, so
 * nobody can trade away the thing that makes their code survive the logo.
 */
const ECL: Ecl = 'M';

/**
 * Modules of plate around the logo on every side. One module is what separates
 * the mark from the modules it sits among; the engine charges it to the
 * error-correction budget like everything else under the plate.
 */
const PLATE_PADDING = 1;

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
  /** The heading: what happened, or that nothing did. */
  title: string;
  text: string;
  /** True when the sentence carries a path — a path is read character by character. */
  mono: boolean;
}

/** What the scan margin knows about the code on screen. */
interface Margin {
  key: string;
  variants: ScanVariant[] | null;
  /** Why it could not be measured, when it could not. Never a refusal. */
  failure: string | null;
}

/** The three files this screen writes. The clipboard is the fourth way out, without a path. */
type ExportKind = 'png' | 'svg' | 'pdf';

/**
 * What each kind is called in the save dialog, on disk, and in the sentence that
 * says it was written.
 */
const FILE: Record<ExportKind, { extension: string; filter: string; format: string }> = {
  png: { extension: 'png', filter: 'PNG image', format: 'PNG' },
  svg: { extension: 'svg', filter: 'SVG image', format: 'SVG' },
  pdf: { extension: 'pdf', filter: 'PDF document', format: 'PDF' },
};

/**
 * What was verified, as one string.
 *
 * The SVG alone is not the artefact any more: the scene carries the plate but
 * not the logo, so two different logos in the same place produce the same SVG
 * and would make a verdict about one of them look like a verdict about the
 * other. The identity the window compares is therefore the code *and* what is
 * being drawn into the middle of it.
 *
 * The printed size is named too, through the raster it comes to: a verdict is
 * about a number of pixels a decoder was handed.
 *
 * The look is named in the key as well as carried by the SVG. A code that
 * changed colour or shape is a different artefact — a decoder that read the
 * black one has said nothing about the blue one — and saying so here means the
 * gate cannot be left showing yesterday's verdict beside today's look, whatever
 * a future scene does with the markup.
 */
function artefactKey(
  svg: string,
  placement: LogoPlacement | null,
  style: Style,
  pixels: number,
): string {
  const logo =
    placement === null
      ? 'no logo'
      : `${placement.id}@${placement.x},${placement.y},${placement.width}x${placement.height}`;
  const look =
    `${style.foreground} on ${style.background}, quiet zone ${style.quietZone}, ` +
    `${style.moduleShape ?? 'square'} modules, ${style.finderShape ?? 'square'} finders`;
  // The raster is part of the identity. A code verified at 295 pixels has had
  // nothing said about it at 5 906: the decoder read a different picture, and
  // the export writes the picture at the size on screen now. Leaving the size
  // out of the key would leave the gate showing a verdict about another print.
  return `${pixels} px\n${logo}\n${look}\n${svg}`;
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
  /**
   * The look, which belongs to the editor for the same reason the logo does: a
   * person who set their brand colours set them for their codes, not for one
   * link. It lives in the shell and survives a change of kind.
   */
  style: Style;
  onStyle: (style: Style) => void;
  /**
   * The lowest error-correction level the person will accept, or `undefined`
   * while the engine decides (SPEC §2.4). It is handed to the placement engine
   * as a floor — never as the level, which stays the engine's to raise.
   */
  ecl: EclFloor | undefined;
  onEcl: (ecl: EclFloor | undefined) => void;
  /**
   * The size the code will be printed at (SPEC §2.5). It lives in the shell with
   * the look and the logo, for the same reason: a person who said their sticker
   * is 25 mm said it about their codes, not about one link. Every number the
   * export writes comes from here.
   */
  printSize: PrintSize;
  onPrintSize: (size: PrintSize) => void;
}

export function CreatePage({
  kind,
  onKind,
  form,
  onForm,
  logo,
  onLogo,
  style,
  onStyle,
  ecl,
  onEcl,
  printSize,
  onPrintSize,
}: CreatePageProps) {
  const result = useMemo(() => buildPayload(form), [form]);
  const payload = result.ok ? result.payload : null;

  /**
   * Whether the printed size is one a code can be printed at, and the raster it
   * comes to. The rule and its sentence are the domain's; this screen only
   * decides what to do about a refusal — which is the same thing it does about
   * every other refusal: say it, and not let the code leave.
   */
  const sizeVerdict = checkPrintSize(printSize);
  const sizeOk = sizeVerdict.ok;
  const sizeRefusal = sizeVerdict.ok ? null : sizeVerdict.reason;
  /**
   * The raster, exactly as the printed size comes to — never clamped.
   *
   * One number for the verdict and for the file: the bytes that were decoded are
   * the bytes that get written, so there is no "verify small, write large". A
   * size whose raster the host would not render is refused by the domain with a
   * sentence about the resolution, not quietly resized here — a person who asked
   * for 1200 dpi and silently got 300 would find out on paper.
   */
  const pixels = pixelsFor(printSize);

  /**
   * The whole decision about this code, made in one place in the domain: the
   * level, the version, the mask, and — with a logo — the box the logo may
   * have. The screen asks once and is told everything, including "no": a logo
   * this content cannot carry comes back as a refusal with the sentence to
   * show, never as a smaller logo nobody asked for.
   */
  const plan = useMemo<Plan | null>(() => {
    if (!result.ok) return null;
    if (logo === null) {
      return planCode(result.payload, {
        logo: false,
        // Without a logo the floor is the level, and `M` is the ordinary
        // choice for a code with nothing covering it.
        ecl: ecl ?? ECL,
        quietZone: style.quietZone,
      });
    }
    const fraction = logoFraction(logo.size);
    return planCode(result.payload, {
      logo: true,
      quietZone: style.quietZone,
      padding: PLATE_PADDING,
      // Left out when nobody chose one: the engine starts at H with a logo and
      // never goes below Q, and a floor passed here can only raise that.
      ...(ecl === undefined ? {} : { ecl }),
      // Left out rather than passed as nothing: "Largest" is the absence of a
      // limit, and the engine reads a missing share as "as large as the budget
      // allows".
      ...(fraction === undefined ? {} : { fraction }),
    });
  }, [result, logo, style.quietZone, ecl]);

  /**
   * Whether the two colours are far enough apart, and the right way round, for
   * a camera to read the code at all. It is a rule about ink rather than about
   * bytes, so it is decided in the domain and asked before the decoder is: a
   * look that no camera can read has nothing worth rasterising.
   */
  const contrast = checkContrast(style);
  // The verdict is a fresh object every render; the answer it carries is not,
  // and it is the answer the scene depends on.
  const contrastOk = contrast.ok;

  /**
   * The refusal, when there is one: the plan's, or the look's. It is a verdict
   * about the code before any decoder is asked — there is no artefact to decode
   * — and it is the only thing this screen says about that code.
   */
  const planRefusal = plan !== null && !plan.ok ? plan.reason : null;
  // The look is only refused once there is a code for it to be the look of: a
  // reason shown over an empty form is a telling-off rather than help.
  const lookRefusal = plan !== null && !contrast.ok ? contrast.reason : null;
  // A size nothing can be printed at is refused where the plan and the look are:
  // there is no artefact at that size to show or to decode, and the sentence is
  // said beside the export button as well as beside the field it is about.
  const refusal = planRefusal ?? lookRefusal ?? sizeRefusal;
  const box = plan !== null && plan.ok ? plan.box : null;

  /** What the figure is called, and what the exported SVG carries as its title. */
  const name = result.ok && refusal === null ? describeCode(result.summary) : 'No code yet';

  // The scene is the code. The same string is what the preview draws, what the
  // decoder is asked about and what the export writes — one artefact, checked
  // once. A preview rendered from anything else would be a picture of a
  // different code. The matrix is the plan's own, with the modules under the
  // plate already knocked out, so no half-module shows at the logo's edge.
  //
  // A look the contrast rule refused is not drawn at all: a picture of a code
  // no camera can read is a promise this product does not make, and the reason
  // is said where every other refusal is said.
  const scene = useMemo(() => {
    if (plan === null || !plan.ok || !contrastOk || !sizeOk)
      return { svg: null, side: null, failure: null };
    try {
      const rendered = renderScene(
        plan.matrix,
        style,
        name,
        logo !== null && plan.box !== null
          ? {
              box: plan.box,
              plate: logo.plate,
              padding: PLATE_PADDING,
              // The plate is the background: a logo sits in a clearing of the
              // colour the code is printed on, not of a colour nobody chose.
              colour: style.background,
            }
          : undefined,
      );
      return { svg: rendered.svg, side: rendered.side, failure: null };
    } catch (error) {
      return {
        svg: null,
        side: null,
        failure: error instanceof Error ? error.message : 'This could not be made into a code.',
      };
    }
  }, [plan, logo, name, style, contrastOk, sizeOk]);
  const svg = scene.svg;

  // The placement, in the shape the host takes. It is the plan's own box, so
  // the picture on the glass and the pixels the decoder is given are one set of
  // module coordinates rendered twice — and it changes exactly when the code
  // does, never between.
  const placement = useMemo<LogoPlacement | null>(
    () => (logo === null || box === null ? null : { id: logo.info.id, ...box }),
    [logo, box],
  );
  const artefact = svg === null ? null : artefactKey(svg, placement, style, pixels);

  // How small the modules come out at the size this version prints at. It is
  // about the code on screen, not about the kind or the payload length, so it
  // is asked of the scene — and it is a warning, never a refusal: it says the
  // card may not scan at 25 mm, and the export button never hears about it.
  const density =
    scene.side === null
      ? null
      : densityWarning({ side: scene.side }, toMillimetres(printSize), densityAdvice(form));

  const [answer, setAnswer] = useState<Answer | null>(null);
  const [written, setWritten] = useState<Written | null>(null);
  const [margin, setMargin] = useState<Margin | null>(null);

  const { mutateAsync: verify } = useVerifyCode();
  const { mutateAsync: writePng, isPending: writingPng } = useExportPng();
  const { mutateAsync: writeSvg, isPending: writingSvg } = useExportSvg();
  const { mutateAsync: writePdf, isPending: writingPdf } = useExportPdf();
  const { mutateAsync: copyToClipboard, isPending: copying } = useCopyPng();
  const { mutateAsync: measure } = useScanMargin();
  // One busy state for the row: four ways out of the same code, one at a time.
  const exporting = writingPng || writingSvg || writingPdf || copying;

  // Only an answer about the code on screen is an answer at all; everything
  // else is derived from that, so nothing has to be reset when the payload
  // changes and nothing can be left over from the payload before it.
  const current = answer !== null && answer.key === artefact ? answer : null;
  // A plan that refused is fed through the same gate as a decoder's answer, in
  // the same shape: one refusal, one sentence, one disabled button. The gate
  // stays the only thing that decides whether this code may leave — there is
  // no second path to the export button, and no decoder to name.
  const planReport: GateReport | null =
    refusal === null ? null : { verified: false, reason: refusal, decoder: '' };
  const report = planReport ?? current?.report ?? null;
  const hostFailure = current?.failure ?? null;
  const inFlight = refusal === null && svg !== null && current === null;
  const message = written !== null && written.key === artefact ? written : null;

  /** Every accepted payload is verified, once the typing stops. */
  useEffect(() => {
    // A size the domain refused never reaches the host: there is no scene at a
    // size nothing can be printed at, and the reason is already on screen.
    if (svg === null || payload === null || artefact === null) return;

    const timer = window.setTimeout(() => {
      verify({ svg, payload, pixelSize: pixels, logo: placement })
        .then((next) => setAnswer({ key: artefact, report: next, failure: null }))
        .catch((error: unknown) =>
          // Not a verdict: the decoder never answered. The gate stays at "not
          // verified yet" and the reason is said separately, because the status
          // must never show a state that did not come back from a decoder.
          setAnswer({ key: artefact, report: null, failure: describeError(error) }),
        );
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [artefact, svg, payload, placement, pixels, verify]);

  // The gate owns the export button. Nothing else is allowed to enable it.
  const gate = gateState(report, inFlight);
  const verified = gate === 'verified';

  /**
   * How far this code can be degraded and still read, asked for once it reads at
   * all. The answer is carried with the code it is about, like the verdict, so a
   * margin measured about a code the window has moved on from is no margin.
   */
  useEffect(() => {
    if (!verified || svg === null || payload === null || artefact === null) return;

    const timer = window.setTimeout(() => {
      measure({ svg, payload, pixelSize: pixels, logo: placement })
        .then((next) => {
          setMargin({ key: artefact, variants: next.variants, failure: null });
          // One sentence rather than nine: the lines are on screen to be read,
          // and a live region that recites all of them is one a person turns off
          // (DESIGN_SYSTEM §7).
          const reads = next.variants.filter((variant) => variant.verified).length;
          announce(`Scan margin measured — ${reads} of ${next.variants.length} still read.`);
        })
        .catch((error: unknown) =>
          setMargin({
            key: artefact,
            variants: null,
            failure: `The margin could not be measured. ${describeError(error)}`,
          }),
        );
    }, MARGIN_MS);

    return () => window.clearTimeout(timer);
  }, [verified, artefact, svg, payload, placement, pixels, measure]);

  /**
   * Write the code, in the format asked for.
   *
   * One function for three formats, because there is one gate and one code: the
   * kind decides the dialog, the extension and the command, and nothing else.
   * The SVG is the one that leaves with a different string from the one the
   * decoder read — the domain's `sizedSvg`, the same scene with its printed
   * width written in — and the host rasterises that string to decide whether it
   * may write it (ADR-026).
   */
  const write = async (kind: ExportKind) => {
    if (svg === null || payload === null || artefact === null) return;
    const file = FILE[kind];
    try {
      const path = await save({
        defaultPath: `signatum.${file.extension}`,
        filters: [{ name: file.filter, extensions: [file.extension] }],
      });
      if (path === null) return;

      const asked = { payload, pixelSize: pixels, path, logo: placement, dpi: printSize.dpi };
      const done =
        kind === 'png'
          ? await writePng({ ...asked, svg })
          : kind === 'svg'
            ? await writeSvg({ ...asked, svg: sizedSvg(svg, printSize) })
            : await writePdf({ ...asked, svg, widthMm: toMillimetres(printSize) });

      setWritten({
        key: artefact,
        tone: 'success',
        title: 'Exported',
        text: `Written to ${path} — ${file.format} verified by ${done.decoder}`,
        mono: true,
      });
      announce(`The ${file.format} was written, verified by ${done.decoder}`);
    } catch (error) {
      // `refused` is not a failure of the export: it is the gate doing its job,
      // and the host's message is already the reason.
      const text = describeError(error);
      setWritten({
        key: artefact,
        tone: 'danger',
        title: 'Nothing was written',
        text,
        mono: false,
      });
      if (errorKind(error) === 'refused') announce(`Nothing was written. ${text}`);
    }
  };

  /**
   * Put the code on the clipboard: the picture, never the payload text. A
   * payload left in the clipboard is a paste into the wrong window, and it is
   * verified before it is copied like everything else that leaves this screen.
   */
  const copy = async () => {
    if (svg === null || payload === null || artefact === null) return;
    try {
      const done = await copyToClipboard({
        svg,
        payload,
        pixelSize: pixels,
        logo: placement,
        dpi: printSize.dpi,
      });
      setWritten({
        key: artefact,
        tone: 'success',
        title: 'Copied',
        text: `Copied to the clipboard — verified by ${done.decoder}`,
        mono: false,
      });
      announce(`The code was copied to the clipboard, verified by ${done.decoder}`);
    } catch (error) {
      const text = describeError(error);
      setWritten({ key: artefact, tone: 'danger', title: 'Nothing was copied', text, mono: false });
      if (errorKind(error) === 'refused') announce(`Nothing was copied. ${text}`);
    }
  };

  /**
   * The scan margin, asked for once a code has passed — and only then, because
   * there is no margin worth measuring around a code that does not read at all.
   *
   * It is deliberately late and deliberately optional: a person typing never
   * waits for it, nothing on screen is disabled by it, and a failure to measure
   * is said in the card rather than anywhere near the export button (ADR-027).
   */
  const marginNow = margin !== null && margin.key === artefact ? margin : null;

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

          <LogoCard logo={logo} onLogo={onLogo} plan={plan} />

          <LookCard style={style} onStyle={onStyle} ecl={ecl} onEcl={onEcl} />

          <SizeCard size={printSize} onSize={onPrintSize} side={scene.side} />
        </div>

        <div className="flex flex-col gap-4">
          <CodePreview
            name={name}
            svg={svg}
            overlay={
              logo !== null && logo.info.dataUrl !== null && box !== null && scene.side !== null
                ? { dataUrl: logo.info.dataUrl, box, side: scene.side }
                : undefined
            }
            caption={
              // The caption is the bytes the code carries; without a code there is nothing
              // to carry, and a refused plan must not leave a page of text under an empty state.
              payload !== null && svg !== null ? (
                <span data-selectable className="font-mono break-all">
                  {payload}
                </span>
              ) : undefined
            }
            placeholder={
              <EmptyState
                icon={<QrCode24Regular />}
                title={
                  refusal !== null
                    ? 'No code for this'
                    : (EMPTY_PROMPT[kind] ?? 'Fill in the form to see its code')
                }
                description={
                  refusal ?? 'The code appears as you type, in the colours it will be printed in.'
                }
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

          {/* Four ways out of one code, and one gate in front of all of them: the
              row is enabled by the verdict beside it and by nothing else. PNG is
              the accented one because it is what most codes are printed from;
              the other three are the same action in another format, not lesser
              ones (DESIGN_SYSTEM §8). */}
          <div className="flex flex-wrap gap-2">
            <Button
              appearance="accent"
              icon={<ArrowDownload20Regular />}
              disabled={!verified || exporting}
              onClick={() => void write('png')}
            >
              Export PNG…
            </Button>
            <Button
              icon={<ArrowDownload20Regular />}
              disabled={!verified || exporting}
              onClick={() => void write('svg')}
            >
              Export SVG…
            </Button>
            <Button
              icon={<ArrowDownload20Regular />}
              disabled={!verified || exporting}
              onClick={() => void write('pdf')}
            >
              Export PDF…
            </Button>
            <Button
              icon={<Copy20Regular />}
              disabled={!verified || exporting}
              onClick={() => void copy()}
            >
              Copy
            </Button>
          </div>

          {message !== null && (
            <InfoBar
              severity={message.tone === 'success' ? 'success' : 'danger'}
              title={message.title}
            >
              <span data-selectable className={message.mono ? 'font-mono' : ''}>
                {message.text}
              </span>
            </InfoBar>
          )}

          {/* Only for a code that passed: there is no margin around a code that
              does not read, and this is a report about one that does. */}
          {verified && (
            <ScanMarginCard
              variants={marginNow?.variants ?? null}
              loading={marginNow === null}
              failure={marginNow?.failure ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
