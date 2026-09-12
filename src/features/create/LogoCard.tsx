import { Image20Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useDeleteLogo, useImportLogo, useLogoDataUrl, useLogos } from '@/data/hooks';
import { logoDataUrl, type LogoInfo } from '@/data/logos';
import { describePlan } from '@/domain/describe';
import { LOGO_SIZE_LABELS, LOGO_SIZES, type LogoSize, type Plate } from '@/domain/logo';
import type { Plan } from '@/domain/placement';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { LogoPlatePicker } from '@/ui/LogoPlatePicker';
import { Select } from '@/ui/Select';

/**
 * The logo, chosen and shown (SPEC §2.4, F4).
 *
 * A logo is not decoration here: it sits in the middle of the code, where the
 * modules are, and the scan gate is asked about the code with it in place. So
 * the card says that in its first sentence, and everything it shows afterwards
 * is about what was really stored — the format the bytes turned out to be, the
 * size they were normalised to, and the host's note when normalisation changed
 * something. A file that was quietly altered is a surprise waiting to be found
 * on paper.
 *
 * The host refuses anything it cannot carry, with one sentence (DESIGN_SYSTEM
 * §10), and that sentence is the whole of what this card says about a refusal:
 * a reason a person can act on, never a crash and never a silent swap.
 */

/** What a person is offered in the dialog. The host decides what they really are. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/**
 * A plate under the logo by default: a code reads better when the logo does not
 * sit straight on the modules, and "None" is one keystroke away for anybody who
 * wants it.
 */
const DEFAULT_PLATE: Plate = 'square';

/**
 * As large as the code can carry, by default.
 *
 * "Largest" is not a gamble: it is the biggest box the error-correction budget
 * allows with a safety margin the placement engine keeps back for print and
 * camera, so the default is both the most useful logo and one the engine has
 * already argued for. The smaller sizes are there for a person who wants less
 * of their code covered — smaller by choice, never larger (SPEC §2.2).
 */
const DEFAULT_SIZE: LogoSize = 'largest';

/** The logo the editor is using, and how it is set into the code. */
export interface ChosenLogo {
  info: LogoInfo;
  plate: Plate;
  size: LogoSize;
}

/** A problem worth a sentence: the host's refusal, or a read that did not happen. */
interface Problem {
  title: string;
  text: string;
}

export function LogoCard({
  logo,
  onLogo,
  plan,
}: {
  logo: ChosenLogo | null;
  onLogo: (logo: ChosenLogo | null) => void;
  /**
   * What the placement engine decided about the code on screen, so that the
   * card can say it in one line. It is read, never acted on: the size asked for
   * lives here, the size granted is the engine's answer.
   */
  plan: Plan | null;
}) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [adopting, setAdopting] = useState(false);

  // What the engine made of the choice, as a sentence: the level and version it
  // needed, and what the logo costs against what a block can spare. It is the
  // one place a person can see that "Largest" was a decision rather than a
  // guess — and it is the domain's words, not this card's.
  const planLine = plan === null ? null : describePlan(plan);

  const logos = useLogos();
  const { mutateAsync: importFile, isPending: importing } = useImportLogo();
  const { mutateAsync: forget, isPending: deleting } = useDeleteLogo();

  /** Choose a file, and let the host decide whether it is an image at all. */
  const choose = async () => {
    setProblem(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
      });
      if (path === null) return;

      const info = await importFile(path);
      onLogo({ info, plate: DEFAULT_PLATE, size: DEFAULT_SIZE });
      announce(`${info.name} is in the middle of the code; it is being checked again.`);
    } catch (error) {
      setProblem({ title: 'This logo cannot be used', text: describeError(error) });
    }
  };

  /** Use a logo already in the store. Its bytes are read only if they are unread. */
  const adopt = async (info: LogoInfo, bytes?: string) => {
    setProblem(null);
    setAdopting(true);
    try {
      const dataUrl = bytes ?? info.dataUrl ?? (await logoDataUrl(info.id));
      onLogo({ info: { ...info, dataUrl }, plate: DEFAULT_PLATE, size: DEFAULT_SIZE });
      announce(`${info.name} is in the middle of the code; it is being checked again.`);
    } catch (error) {
      setProblem({ title: 'That logo could not be opened', text: describeError(error) });
    } finally {
      setAdopting(false);
    }
  };

  /**
   * Take the logo out of the code — and out of the store with it, because a
   * logo nobody is using is a file this product has no reason to keep.
   */
  const remove = async () => {
    if (logo === null) return;
    setProblem(null);
    const { id, name } = logo.info;
    onLogo(null);
    try {
      await forget(id);
      announce(`${name} was removed; the code is being checked again.`);
    } catch (error) {
      setProblem({
        title: 'The logo was taken out of the code, but not deleted',
        text: describeError(error),
      });
    }
  };

  return (
    <Card title="Logo">
      {logo === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-fg-secondary">
            A logo sits in the middle of the code; the code is checked with it in place.
          </p>
          <div>
            <Button
              icon={<Image20Regular />}
              disabled={importing || adopting}
              onClick={() => void choose()}
            >
              Choose a logo…
            </Button>
          </div>
          <UsedLogos
            state={logos}
            disabled={importing || adopting}
            onUse={(info, bytes) => void adopt(info, bytes)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex shrink-0 items-center justify-center rounded-md border border-stroke-subtle bg-card p-1">
              {logo.info.dataUrl !== null ? (
                <img
                  src={logo.info.dataUrl}
                  alt={logo.info.name}
                  className="max-h-24 max-w-24 object-contain"
                />
              ) : (
                <span className="px-2 text-caption text-fg-tertiary">No preview</span>
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-body text-fg">{logo.info.name}</p>
              <p className="text-caption text-fg-secondary">
                {logo.info.format.toUpperCase()} · {logo.info.width}×{logo.info.height}
              </p>
              {logo.info.note !== null && (
                <p className="text-caption text-fg-tertiary">{logo.info.note}</p>
              )}
            </div>
          </div>

          <LogoPlatePicker
            value={logo.plate}
            onChange={(plate) => onLogo({ ...logo, plate })}
            disabled={deleting}
          />

          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">Size</span>
            <Select
              aria-label="Size"
              value={logo.size}
              disabled={deleting}
              onChange={(event) => onLogo({ ...logo, size: event.target.value as LogoSize })}
            >
              {LOGO_SIZES.map((size) => (
                <option key={size} value={size}>
                  {LOGO_SIZE_LABELS[size]}
                </option>
              ))}
            </Select>
          </label>

          {planLine !== null && <p className="text-caption text-fg-secondary">{planLine}</p>}

          <div>
            <Button appearance="subtle" disabled={deleting} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </div>
      )}

      {problem !== null && (
        <div className="mt-3">
          <InfoBar severity="danger" title={problem.title}>
            {problem.text}
          </InfoBar>
        </div>
      )}
    </Card>
  );
}

/**
 * The logos already imported, so a second code does not need the file again.
 *
 * A list that could not be read says so rather than looking empty: an empty row
 * and an unanswered question look identical, and only one of them is true
 * (DESIGN_SYSTEM §2, "A view says what it left out").
 */
function UsedLogos({
  state,
  disabled,
  onUse,
}: {
  state: ReturnType<typeof useLogos>;
  disabled: boolean;
  onUse: (info: LogoInfo, bytes?: string) => void;
}) {
  if (state.isPending) {
    return <p className="text-caption text-fg-secondary">Looking for logos you have used…</p>;
  }
  if (state.isError) {
    return (
      <p className="text-caption text-fg-secondary">
        The logos you have used could not be listed. {describeError(state.error)}
      </p>
    );
  }
  if (state.data.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-fg-secondary">Logos you have used</p>
      <ul className="flex flex-wrap gap-2">
        {state.data.map((info) => (
          <li key={info.id}>
            <UsedLogo info={info} disabled={disabled} onUse={onUse} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One stored logo as a button. Its bytes are read for the thumbnail, once —
 * the name carries it until they arrive, so the control is nameable and
 * pressable before there is a picture in it.
 */
function UsedLogo({
  info,
  disabled,
  onUse,
}: {
  info: LogoInfo;
  disabled: boolean;
  onUse: (info: LogoInfo, bytes?: string) => void;
}) {
  const bytes = useLogoDataUrl(info.id);
  return (
    <Button
      appearance="subtle"
      aria-label={`Use ${info.name}`}
      disabled={disabled}
      /* Taller than a control, never shorter: the thumbnail sets the height and
         the density token remains the floor. */
      className="h-auto min-h-(--density-control) p-1"
      onClick={() => onUse(info, bytes.data)}
    >
      {bytes.data === undefined ? (
        <span className="max-w-24 truncate text-caption text-fg-secondary">{info.name}</span>
      ) : (
        <img src={bytes.data} alt={info.name} className="max-h-12 max-w-12 object-contain" />
      )}
    </Button>
  );
}
