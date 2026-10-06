import { ScanCamera24Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useCheckFile, useCode, useReadClipboard, useReadImage } from '@/data/hooks';
import type { SavedCode } from '@/data/library';
import type { ReadCode, Reading, StampCheck } from '@/data/read';
import { describeBytes, wouldScanAt, type ReadKind, type ScanVerdict } from '@/domain/read';
import { LENGTH_UNIT_LABELS, LENGTH_UNITS, toMillimetres, type LengthUnit } from '@/domain/size';
import { AddressSentences } from '@/features/create/AddressSentences';
import { stampSentence } from '@/features/read/stampSentence';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * Read (SPEC §2.9, F10): a code somebody else made, said in this product's own words.
 *
 * Two doors in — a file and the clipboard — and one thing on the way out: what the bytes mean,
 * how the symbol was built, and whether a code of that many modules survives being printed at a
 * width. A third door (P2) checks a file this product exported: it is never drawn and never
 * decoded, only its stamp is read, and the answer is one sentence on a Stamp card — the same card
 * a stamped PNG opened through the first door shows above its codes. The decoding is the host's and the meaning is the domain's; this screen owns neither,
 * which is what makes a code that was read and a code that was made describe themselves in the
 * same sentences.
 *
 * Nothing read is stored, and nothing found in an image is ever acted on: a link in a photograph
 * is shown as text, never followed. The content is data here, the way a payload is data on
 * Create.
 */

/** What a kind is called on screen — the product's words, not the grammar's. */
const KIND_LABELS: Record<ReadKind, string> = {
  link: 'Link',
  text: 'Text',
  email: 'E-mail',
  phone: 'Phone',
  sms: 'SMS',
  wifi: 'Wi-Fi',
  geo: 'Place',
  contact: 'Contact',
  other: 'Other',
};

/** The verdict as a word, so the colour is never the only thing carrying it (DESIGN_SYSTEM §7). */
const VERDICT_WORDS: Record<ScanVerdict, string> = {
  reads: 'Reads',
  tight: 'Tight',
  'too small': 'Too small',
};

const VERDICT_TONES: Record<ScanVerdict, string> = {
  reads: 'text-success',
  tight: 'text-caution',
  'too small': 'text-danger',
};

/** What the payload is prefilled into on Create, when it is one of ours. */
export interface MadeFromRead {
  kind: 'link' | 'text';
  text: string;
}

/** A door that refused, in the door's own title and the host's own sentence. */
export interface ReadRefusal {
  title: string;
  sentence: string;
}

/**
 * What the screen is looking at: one reading, one checked file, or the sentence that refused
 * either — never two of them.
 *
 * It is held by the shell, for the reason the batch's rows are: a person goes to Settings to
 * switch the theme and comes back, and the photograph they were reading has to still be there.
 * In memory only, for as long as the window lives — nothing read is written anywhere.
 */
export interface ReadState {
  reading: Reading | null;
  check: StampCheck | null;
  problem: ReadRefusal | null;
}

/** What Open answers — the Library's own contract, because it is the Library's own path. */
type OpenSaved = (saved: SavedCode) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** The titles a refusal carries, one per kind of door. */
const IMAGE_REFUSED = 'The image could not be read';
const FILE_REFUSED = 'The file could not be checked';

/** `1 code`, `2 codes` — a count that reads as English at both ends. */
function codes(n: number): string {
  return `${n} ${n === 1 ? 'code' : 'codes'}`;
}

export function ReadPage({
  state,
  onState,
  onMake,
  onOpen,
}: {
  state: ReadState;
  onState: (state: ReadState) => void;
  onMake: (made: MadeFromRead) => void;
  /** Open a saved code in Create — the path the Library's Open button takes. */
  onOpen: OpenSaved;
}) {
  const { reading, check, problem } = state;

  const { mutateAsync: readFile, isPending: opening } = useReadImage();
  const { mutateAsync: readPasted, isPending: pasting } = useReadClipboard();
  const { mutateAsync: checkStamp, isPending: checking } = useCheckFile();
  const busy = opening || pasting || checking;

  /** One reading replaces the last one whole: a picture and a list about two images is a lie. */
  const took = (result: Reading) => {
    onState({ reading: result, check: null, problem: null });
    const found =
      result.codes.length === 0
        ? (result.note ?? 'Nothing was found in this image.')
        : `The image was read — ${codes(result.codes.length)} found.`;
    announce(result.stamp === null ? found : `${found} ${stampSentence(result.stamp).sentence}`);
  };

  /** A checked file replaces whatever was on screen, for the same reason. */
  const checked = (result: StampCheck) => {
    onState({ reading: null, check: result, problem: null });
    announce(stampSentence(result).sentence);
  };

  /**
   * A refusal clears what was on screen.
   *
   * The alternative is a sentence about the file that was just refused sitting above the picture
   * of a different one, which is the kind of half-truth this screen exists to remove.
   */
  const failed = (title: string, error: unknown) => {
    onState({ reading: null, check: null, problem: { title, sentence: describeError(error) } });
  };

  const chooseImage = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (typeof path !== 'string') return;
      took(await readFile(path));
    } catch (error) {
      failed(IMAGE_REFUSED, error);
    }
  };

  const pasteImage = async () => {
    try {
      took(await readPasted());
    } catch (error) {
      failed(IMAGE_REFUSED, error);
    }
  };

  const chooseExported = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Exported files', extensions: ['png', 'svg', 'pdf'] }],
      });
      if (typeof path !== 'string') return;
      checked(await checkStamp(path));
    } catch (error) {
      failed(FILE_REFUSED, error);
    }
  };

  // Exactly one thing is on screen, so at most one stamp is: the checked file's, or the stamp of
  // the PNG that was opened.
  const stamp = check ?? reading?.stamp ?? null;
  const showing = reading !== null || check !== null;

  /**
   * The three doors, rendered once.
   *
   * They sit in the empty state while there is nothing to look at and in the card's header once
   * there is, rather than in both places at once: two buttons with the same name on one surface
   * is an ambiguity for anybody addressing them by name — a screen reader, a keyboard, a test.
   */
  const doors = (
    <div className="flex flex-wrap items-center gap-2">
      <Button appearance="accent" disabled={busy} onClick={() => void chooseImage()}>
        Open an image…
      </Button>
      <Button disabled={busy} onClick={() => void pasteImage()}>
        Paste from clipboard
      </Button>
      <Button disabled={busy} onClick={() => void chooseExported()}>
        Check an exported file…
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Read</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Open a photograph or a screenshot of a code and see what it holds, how it was built, and
          whether it would scan at a printed size.
        </p>
      </header>

      <Card
        title="Image"
        description="Nothing opened here is stored, and nothing found in it is ever followed."
        actions={showing ? doors : undefined}
      >
        <div className="flex flex-col gap-3">
          {problem !== null && (
            <InfoBar severity="danger" title={problem.title}>
              {problem.sentence}
            </InfoBar>
          )}

          {/* Not a live region: the buttons are disabled while this is on screen, and the
              outcome is announced when it arrives (DESIGN_SYSTEM §7). */}
          {busy && (
            <p className="text-caption text-fg-secondary">
              {checking ? 'Checking the file…' : 'Reading the image…'}
            </p>
          )}

          {!showing && problem === null && (
            <EmptyState
              icon={<ScanCamera24Regular />}
              title="Nothing read yet"
              description="Open a photograph or a screenshot of a code, and what it holds appears here — or check whether a file this product exported was changed."
              action={doors}
            />
          )}

          {!showing && problem !== null && doors}

          {/* A checked file is never drawn, so there is no picture here — and the card says so
              rather than standing empty, which would look like a picture that failed to load. */}
          {check !== null && (
            <p className="text-caption text-fg-tertiary">
              The file was checked for its stamp; nothing in it was drawn or decoded.
            </p>
          )}

          {reading !== null && (
            <>
              <ImageRead reading={reading} />
              {reading.note !== null && (
                <InfoBar
                  severity={reading.codes.length === 0 ? 'caution' : 'info'}
                  title={reading.note}
                />
              )}
            </>
          )}
        </div>
      </Card>

      {/* Above the codes: what the file says about itself comes before what is in it. */}
      {stamp !== null && (
        <StampCard
          key={`${stamp.kind}-${stamp.decoder}-${stamp.verifiedAt}-${stamp.codeId}`}
          check={stamp}
          onOpen={onOpen}
        />
      )}

      {reading?.codes.map((code, index) => (
        // Keyed by the reading as well as the slot, so a card from the last image is never
        // reused for this one — a revealed password does not survive into another picture.
        <CodeCard
          key={`${reading.decodeMs}-${reading.width}-${reading.height}-${index}`}
          index={index + 1}
          code={code}
          onMake={onMake}
        />
      ))}
    </div>
  );
}

/**
 * What a file's stamp says (P2): exactly one sentence, in the tone it deserves, and — when this
 * workspace verified it from a saved code still in the library — that code's name and a way to
 * open it.
 *
 * The date and the name are the workspace's, never the file's: the host fills them only when its
 * own row matches the stamp, so a stamp copied from elsewhere cannot bring a date with it.
 */
function StampCard({ check, onOpen }: { check: StampCheck; onOpen: OpenSaved }) {
  const said = stampSentence(check);
  const saved =
    check.intact && check.matchesRecord && check.codeId !== null && check.codeName !== null
      ? { id: check.codeId, name: check.codeName }
      : null;

  return (
    <Card label="Stamp" title="Stamp">
      <InfoBar severity={said.severity} title={said.sentence}>
        {said.detail ??
          (saved === null ? null : <SavedAs id={saved.id} name={saved.name} onOpen={onOpen} />)}
      </InfoBar>
    </Card>
  );
}

/**
 * `Saved as Menu.` and an Open button that opens it — through the Library's own path, so a code
 * opened from here lands in Create exactly as one opened from the Library does.
 *
 * The code is fetched as the card appears, the way a Library row fetches it, and Open waits for
 * it: opening a code needs the code.
 */
function SavedAs({ id, name, onOpen }: { id: string; name: string; onOpen: OpenSaved }) {
  const code = useCode(id);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const openIt = async () => {
    const saved = code.data;
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span>{`Saved as ${name}.`}</span>
        <Button
          aria-label={`Open ${name}`}
          disabled={code.data === undefined || opening}
          onClick={() => void openIt()}
        >
          Open
        </Button>
      </div>
      {code.isError && (
        <p className="text-caption">{`This code could not be read. ${describeError(code.error)}`}</p>
      )}
      {problem !== null && <p className="text-caption">{problem}</p>}
    </div>
  );
}

/**
 * The image, with what was found in it outlined.
 *
 * The overlay's coordinate system is the source image's own pixels — the ones the corners are in
 * — and it is stretched over exactly the box the picture occupies, so the outline lands on the
 * code whatever size the host sent the preview at. The stroke is `non-scaling-stroke` on purpose:
 * three pixels of a four-thousand-pixel photograph shown six hundred wide is not a line anybody
 * can see, and the rule is three pixels on screen.
 */
function ImageRead({ reading }: { reading: Reading }) {
  const outlined = reading.codes.filter((code) => code.corners.length >= 3);
  return (
    <figure aria-label="Image read" className="flex flex-col gap-2">
      <div className="relative w-full overflow-hidden rounded-lg border border-stroke-subtle">
        <img src={reading.preview} alt="The image opened" className="block h-auto w-full" />
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${reading.width} ${reading.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {outlined.map((code, index) => (
            <polygon
              key={index}
              points={code.corners.map(([x, y]) => `${x},${y}`).join(' ')}
              className="fill-none stroke-accent"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <figcaption className="text-caption text-fg-tertiary">
        {`${reading.width} × ${reading.height} px · ${codes(reading.codes.length)} · ${reading.decodeMs} ms`}
      </figcaption>
    </figure>
  );
}

/** The dots a secret is shown as until somebody asks for it. */
const DOTS = '••••••••';

/**
 * The content with the Wi-Fi password taken out of it, and nothing else changed.
 *
 * Masking the whole string would hide the network name, the security and the rest of what a
 * person came to read; masking the `P:` field means walking the same `KEY:value;` grammar the
 * domain parses, escapes included, so that a password containing a semicolon is masked entirely
 * rather than half. Anything marked sensitive that is not a Wi-Fi string is hidden whole — a
 * secret this screen cannot locate is a secret it does not show.
 */
function maskSecret(content: string): string {
  if (!content.toLowerCase().startsWith('wifi:')) return DOTS;
  let out = content.slice(0, 'WIFI:'.length);
  let i = out.length;
  while (i < content.length) {
    let key = '';
    while (i < content.length && content[i] !== ':' && content[i] !== ';') {
      key += content[i];
      i += 1;
    }
    if (i >= content.length) {
      out += key;
      break;
    }
    if (content[i] === ';') {
      out += `${key};`;
      i += 1;
      continue;
    }
    i += 1;
    let value = '';
    while (i < content.length) {
      const c = content[i] ?? '';
      if (c === '\\' && i + 1 < content.length) {
        value += c + (content[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (c === ';') break;
      value += c;
      i += 1;
    }
    const closed = i < content.length;
    if (closed) i += 1;
    out += `${key}:${key.toUpperCase() === 'P' ? DOTS : value}${closed ? ';' : ''}`;
  }
  return out;
}

/** One code found in the image: what it means, how it was built, and how small it prints. */
function CodeCard({
  index,
  code,
  onMake,
}: {
  index: number;
  code: ReadCode;
  onMake: (made: MadeFromRead) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [width, setWidth] = useState('25');
  const [unit, setUnit] = useState<LengthUnit>('mm');

  // The bytes are described once per code: the sentences are the domain's, and they are the same
  // ones the Create screen says about a code being made.
  const description = useMemo(() => describeBytes(code.bytes), [code.bytes]);

  const name = `Code ${index}`;

  // A pattern that did not decode has nothing else true to say about it: no version, no level, no
  // content. It is listed all the same, because it is on the picture and it is outlined there.
  if (code.error !== null) {
    return (
      <Card label={name} title={name}>
        <p className="text-body text-fg-secondary">{code.error}</p>
      </Card>
    );
  }

  const typed = width.trim() === '' ? Number.NaN : Number(width);
  const mm = toMillimetres({ value: typed, unit });
  const scan =
    Number.isFinite(mm) && mm > 0 && code.sideModules > 0
      ? wouldScanAt(code.sideModules, mm)
      : null;

  const shown =
    description.sensitive && !revealed ? maskSecret(description.content) : description.content;

  // Only the two kinds whose whole payload is a single field go back to Create as themselves. A
  // contact or a Wi-Fi is a form with parts, and filling one from bytes is its own slice.
  const makeKind: MadeFromRead['kind'] | null =
    description.kind === 'link' ? 'link' : description.kind === 'text' ? 'text' : null;

  return (
    <Card label={name} title={name}>
      <div className="flex flex-col gap-4">
        <p className="text-body-lg text-fg">{description.summary}</p>

        {/* Above the facts, because it is the one worth reading before anybody follows the
            address: a look-alike, a shortener, a raw IP (ADR-034). It says, and never refuses —
            "Make a code like this" stays where it was. */}
        {description.warnings.length > 0 && (
          <InfoBar severity="caution" title="Check this address before you open it">
            <AddressSentences sentences={description.warnings} />
          </InfoBar>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-fg-secondary">Kind</dt>
          <dd className="text-fg">{KIND_LABELS[description.kind]}</dd>

          <dt className="text-fg-secondary">Built as</dt>
          <dd className="text-fg">
            {`Version ${code.version} · Level ${code.ecl} · Mask ${code.mask} · ${code.sideModules} modules`}
          </dd>

          <dt className="text-fg-secondary">Content</dt>
          <dd className="min-w-0">
            <span
              data-selectable
              className="block font-mono text-caption break-words whitespace-pre-wrap text-fg"
            >
              {shown}
            </span>
            {description.sensitive && (
              <Button
                className="mt-2"
                aria-pressed={revealed}
                onClick={() => setRevealed(!revealed)}
              >
                {revealed ? 'Hide' : 'Reveal'}
              </Button>
            )}
          </dd>
        </dl>

        {description.details.length > 0 && (
          <ul className="flex flex-col gap-1 text-caption text-fg-secondary">
            {description.details.map((detail, at) => (
              <li key={at}>{detail}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-caption font-semibold text-fg-secondary">Would it scan at</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="flex flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">Printed width</span>
              <Input
                aria-label="Printed width"
                type="number"
                inputMode="decimal"
                min={0}
                step={unit === 'mm' ? 1 : 0.1}
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">Unit</span>
              <Select
                aria-label="Unit"
                value={unit}
                onChange={(event) => {
                  const chosen = LENGTH_UNITS.find((each) => each === event.target.value);
                  setUnit(chosen ?? 'mm');
                }}
              >
                {LENGTH_UNITS.map((each) => (
                  <option key={each} value={each}>
                    {LENGTH_UNIT_LABELS[each]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {/* The verdict is a word and a sentence, and the colour is the third thing saying it. */}
          <p role="status" className="text-body text-fg-secondary">
            {scan === null ? (
              'Type a printed width to see whether it would scan.'
            ) : (
              <>
                <span className={`font-semibold ${VERDICT_TONES[scan.verdict]}`}>
                  {VERDICT_WORDS[scan.verdict]}
                </span>
                {`: ${scan.sentence}`}
              </>
            )}
          </p>
        </div>

        {makeKind !== null && (
          <div>
            <Button onClick={() => onMake({ kind: makeKind, text: description.content })}>
              Make a code like this
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
