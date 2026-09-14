import { useEffect, useRef, useState } from 'react';

import { describeError } from '@/data/errors';
import { useSetSetting, useSettings } from '@/data/hooks';
import {
  BUILT_IN_SETTINGS,
  MAX_QUIET_ZONE_MODULES,
  MAX_WIDTH_MM,
  MIN_QUIET_ZONE_MODULES,
  MIN_WIDTH_MM,
  type SettingKey,
  type Settings,
} from '@/data/settings';
import { THEME_LABELS, THEMES, type ThemeChoice } from '@/domain/settings';
import {
  DPI_CHOICES,
  formatMillimetres,
  LENGTH_UNIT_LABELS,
  LENGTH_UNITS,
  MM_PER_INCH,
  type LengthUnit,
} from '@/domain/size';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { announce } from '@/ui/announce';

/**
 * Settings.
 *
 * Two cards: how the application looks, and what a new code starts as. Both are kept in the
 * workspace's own settings table, so a choice survives the window that made it — and nothing
 * here leaves this machine.
 *
 * The theme is held by the window shell and applied there, so every screen changes at once and
 * no screen has to remember to; this page offers the choice and records it. The defaults are
 * read by the shell when the window opens, which is why changing one here changes what the
 * *next* code starts as and never the code somebody is in the middle of making.
 */
export function SettingsPage({
  theme,
  onChoose,
}: {
  theme: ThemeChoice;
  onChoose: (next: ThemeChoice) => void;
}) {
  const settings = useSettings();
  // A workspace that could not be read is not a workspace with no preferences: the built-in
  // defaults stand, and the card says so rather than presenting them as somebody's choices
  // (DESIGN_SYSTEM §10).
  const unread = settings.isError ? describeError(settings.error) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Chosen here, kept on this machine, and nowhere else.
        </p>
      </header>

      <AppearanceCard theme={theme} onChoose={onChoose} />
      <DefaultsCard settings={settings.data ?? BUILT_IN_SETTINGS} unread={unread} />
    </div>
  );
}

function AppearanceCard({
  theme,
  onChoose,
}: {
  theme: ThemeChoice;
  onChoose: (next: ThemeChoice) => void;
}) {
  const kept = useSetSetting();

  return (
    <Card title="Appearance" description="Light, dark, or whatever Windows is set to.">
      <ChoiceGroup
        label="Theme"
        options={THEMES}
        value={theme}
        labels={THEME_LABELS}
        onChange={(next: ThemeChoice) => {
          // Applied to this window, and written to the table it will be read back from. A
          // choice is one decision, so it is one press — the write is not a second step a
          // person has to know about.
          onChoose(next);
          kept.mutate({ key: 'theme', value: next });
          announce(`Theme set to ${THEME_LABELS[next].toLowerCase()}`);
        }}
      />
      <p className="mt-3 text-caption text-fg-tertiary">
        The theme colours the application, never the code. A code is previewed and exported in the
        colours it will be printed in, so what you see here is what a camera will read there.
      </p>
      {kept.isError && (
        <div className="mt-3">
          <InfoBar severity="caution" title="This window changed; the workspace did not">
            {describeError(kept.error)}
          </InfoBar>
        </div>
      )}
    </Card>
  );
}

/**
 * How long after a keystroke a number is written.
 *
 * Long enough that somebody typing "300" writes once rather than three times, short enough that
 * the "Saved." under the box arrives while they are still looking at it. It is the same pause
 * the editor waits before asking a decoder about a code, for the same reason.
 */
const SAVE_MS = 300;

/**
 * The resolutions this product renders at, in words, from the domain's own list — so a list that
 * grows is a sentence that grows with it rather than one somebody has to remember to edit.
 */
const RENDERED_AT = `A code is rendered at ${DPI_CHOICES.slice(0, -1).join(', ')} or ${
  DPI_CHOICES[DPI_CHOICES.length - 1]
} dpi.`;

/**
 * What the width box offers per unit: the domain's own bounds, and a step a person would nudge
 * by. They are the field's manners rather than the rule — the rule is the host's, and its
 * refusal arrives as a sentence.
 */
const WIDTH_BOUNDS: Record<LengthUnit, { min: number; max: number; step: number }> = {
  mm: { min: MIN_WIDTH_MM, max: MAX_WIDTH_MM, step: 1 },
  in: {
    min: Number((MIN_WIDTH_MM / MM_PER_INCH).toFixed(1)),
    max: Number((MAX_WIDTH_MM / MM_PER_INCH).toFixed(1)),
    step: 0.1,
  },
};

function DefaultsCard({ settings, unread }: { settings: Settings; unread: string | null }) {
  return (
    <Card
      title="Defaults"
      description="What a new code starts as. Changing one here leaves every code already made as it is."
    >
      {unread !== null && (
        <div className="mb-3">
          <InfoBar severity="caution" title="These are the built-in defaults">
            {unread}
          </InfoBar>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <WidthDefault widthMm={settings.defaultWidthMm} />
        <ResolutionDefault dpi={settings.defaultDpi} />
        <QuietZoneDefault modules={settings.defaultQuietZone} />
        <PasswordDefault keep={settings.keepWifiPasswords} />
      </div>
    </Card>
  );
}

/**
 * Write one setting, once the typing stops.
 *
 * The pause is held in a ref and restarted by the keystroke, never by a render: a debounce
 * driven by an effect would be restarted by the write's own state change, and a field that
 * saves because it just saved writes forever.
 */
function useKeptSetting(key: SettingKey) {
  const { mutate, isSuccess, isError, error } = useSetSetting();
  const pending = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
    },
    [],
  );

  const clear = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
  };

  return {
    /** After the pause — for a box somebody is typing into. */
    keepSoon: (value: string) => {
      clear();
      pending.current = window.setTimeout(() => mutate({ key, value }), SAVE_MS);
    },
    /** Now — for a choice made in one press, which is a decision and not a keystroke. */
    keepNow: (value: string) => {
      clear();
      mutate({ key, value });
    },
    /** Nothing to write: the box is empty, and an empty box is not a value. */
    hold: clear,
    saved: isSuccess,
    problem: isError ? describeError(error) : null,
  };
}

/**
 * What a field says about its own last write.
 *
 * A refusal is the host's sentence, in the tone every other refusal takes; a success is one
 * quiet word under the control. Neither is announced: these fields are typed into, and a live
 * region that speaks while somebody types is one they turn off (DESIGN_SYSTEM §7). The `InfoBar`
 * is a status region of its own, so a refusal that appears is still read out once.
 */
function Note({ problem, caption }: { problem: string | null; caption: string }) {
  if (problem !== null) {
    return (
      <InfoBar severity="caution" title="This was not kept">
        {problem}
      </InfoBar>
    );
  }
  return <span className="block min-h-5 text-caption text-fg-tertiary">{caption}</span>;
}

function WidthDefault({ widthMm }: { widthMm: number }) {
  const { keepSoon, hold, saved, problem } = useKeptSetting('default_width_mm');
  // The unit is how the number is typed, not what is kept: the table holds millimetres, which
  // is why it is not a setting of its own. It resets to millimetres with the window, and the
  // line under the row says which unit the workspace is really holding.
  const [unit, setUnit] = useState<LengthUnit>('mm');
  const [typed, setTyped] = useState<string | null>(null);

  const stored =
    unit === 'in' ? String(Number((widthMm / MM_PER_INCH).toFixed(2))) : formatMillimetres(widthMm);
  const bounds = WIDTH_BOUNDS[unit];
  const empty = typed !== null && typed.trim() === '';

  const edit = (next: string) => {
    setTyped(next);
    const value = Number(next);
    // A box being emptied is not a width of zero, and a half-typed "1." is not a width of one:
    // nothing is written until there is a number to write.
    if (next.trim() === '' || !Number.isFinite(value)) {
      hold();
      return;
    }
    keepSoon(formatMillimetres(unit === 'in' ? value * MM_PER_INCH : value));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Default width</span>
          <Input
            aria-label="Default width"
            type="number"
            inputMode="decimal"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={typed ?? stored}
            onChange={(event) => edit(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Unit</span>
          <Select
            aria-label="Default width unit"
            value={unit}
            onChange={(event) => {
              const chosen = LENGTH_UNITS.find((each) => each === event.target.value);
              setUnit(chosen ?? 'mm');
              // The box re-reads the stored width in the unit now in force, rather than
              // reinterpreting the digits that are in it as the other one.
              setTyped(null);
              hold();
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
      <Note
        problem={problem}
        caption={
          empty
            ? 'Nothing is kept while the box is empty.'
            : saved
              ? `Saved. Kept as ${formatMillimetres(widthMm)} mm.`
              : `Kept as ${formatMillimetres(widthMm)} mm.`
        }
      />
    </div>
  );
}

function ResolutionDefault({ dpi }: { dpi: number }) {
  const { keepSoon, hold, saved, problem } = useKeptSetting('default_dpi');
  const [typed, setTyped] = useState<string | null>(null);
  const empty = typed !== null && typed.trim() === '';
  // A resolution this product cannot render is not written. The host would take it — it keeps
  // any whole number from 72 to 1200 — but the editor draws at the four the domain offers, and a
  // default the Create screen would refuse is a workspace that opens on a refusal.
  const unrendered = typed !== null && typed.trim() !== '' && !DPI_CHOICES.includes(Number(typed));

  const edit = (next: string) => {
    setTyped(next);
    const value = Number(next);
    if (next.trim() === '' || !DPI_CHOICES.includes(value)) {
      hold();
      return;
    }
    keepSoon(String(value));
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Default resolution</span>
        <Input
          aria-label="Default resolution"
          aria-invalid={unrendered}
          type="number"
          inputMode="numeric"
          min={DPI_CHOICES[0]}
          max={DPI_CHOICES[DPI_CHOICES.length - 1]}
          step={1}
          value={typed ?? String(dpi)}
          onChange={(event) => edit(event.target.value)}
        />
      </label>
      <Note
        problem={problem ?? (unrendered ? RENDERED_AT : null)}
        caption={empty ? 'Nothing is kept while the box is empty.' : saved ? 'Saved.' : RENDERED_AT}
      />
    </div>
  );
}

function QuietZoneDefault({ modules }: { modules: number }) {
  const { keepSoon, hold, saved, problem } = useKeptSetting('default_quiet_zone');
  const [typed, setTyped] = useState<string | null>(null);
  const empty = typed !== null && typed.trim() === '';

  const edit = (next: string) => {
    setTyped(next);
    const value = Number(next);
    if (next.trim() === '' || !Number.isInteger(value)) {
      hold();
      return;
    }
    keepSoon(String(value));
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">Default quiet zone</span>
        <Input
          aria-label="Default quiet zone"
          type="number"
          inputMode="numeric"
          min={MIN_QUIET_ZONE_MODULES}
          max={MAX_QUIET_ZONE_MODULES}
          step={1}
          value={typed ?? String(modules)}
          onChange={(event) => edit(event.target.value)}
        />
      </label>
      <Note
        problem={problem}
        caption={
          empty
            ? 'Nothing is kept while the box is empty.'
            : saved
              ? 'Saved.'
              : 'Modules of blank margin around the code. The standard asks for 4.'
        }
      />
    </div>
  );
}

function PasswordDefault({ keep }: { keep: boolean }) {
  const { keepNow, saved, problem } = useKeptSetting('keep_wifi_passwords');

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <Checkbox
          label="Keep Wi-Fi passwords in saved codes"
          checked={keep}
          onChange={(next) => keepNow(next ? 'true' : 'false')}
        />
        <span className="text-body text-fg">Keep Wi-Fi passwords in saved codes</span>
      </label>
      <Note
        problem={problem}
        caption={
          saved
            ? 'Saved.'
            : 'Saved codes keep this password in the clear on this machine. The Save form can still untick it for one code.'
        }
      />
    </div>
  );
}
