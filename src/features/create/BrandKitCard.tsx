import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useBrandKits, useDeleteBrandKit, useSaveBrandKit } from '@/data/hooks';
import type { BrandKit } from '@/data/library';
import { applyKit, checkName, type ChosenLogoRef, type EclFloor } from '@/domain/library';
import type { Style } from '@/domain/scene';
import type { PrintSize } from '@/domain/size';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import type { ChosenLogo } from './LogoCard';
import { resolveLogo } from './resolveLogo';

/**
 * A brand kit: a logo, a look and a size, applied to a new code in one click (SPEC §2.7).
 *
 * It sits under the Look card because that is what it is made of — the colours, the shapes, the
 * margin, the error-correction floor, the printed size and the mark — and never the payload. A
 * kit says how a code looks; what it *does* is the person's business every time.
 *
 * Applying is one action, not a form: choosing a kit is choosing it. What it sets is the domain's
 * `applyKit`, so the card cannot quietly apply more or less than a kit is.
 */
export function BrandKitCard({
  style,
  onStyle,
  ecl,
  onEcl,
  printSize,
  onPrintSize,
  logo,
  onLogo,
}: {
  style: Style;
  onStyle: (style: Style) => void;
  ecl: EclFloor | undefined;
  onEcl: (ecl: EclFloor | undefined) => void;
  printSize: PrintSize;
  onPrintSize: (size: PrintSize) => void;
  logo: ChosenLogo | null;
  onLogo: (logo: ChosenLogo | null) => void;
}) {
  const kits = useBrandKits();
  const { mutateAsync: keep, isPending: saving } = useSaveBrandKit();
  const { mutateAsync: forget, isPending: deleting } = useDeleteBrandKit();

  /** The kit on screen: the one that was applied, and the one "Delete kit" is about. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** The name being typed, or null while nobody is naming a kit. */
  const [typed, setTyped] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const available = kits.data ?? [];
  const selected = available.find((kit) => kit.id === chosen) ?? null;

  /** The logo as a kit keeps it: which one, on what plate, at what size — never the bytes. */
  const reference: ChosenLogoRef | null =
    logo === null ? null : { id: logo.info.id, plate: logo.plate, size: logo.size };

  /**
   * Apply a kit: the look, the floor, the size and the logo, in one click.
   *
   * The logo is the one part that has to be fetched — a kit keeps a reference, and the code needs
   * the bytes — and a reference the store can no longer answer is said out loud rather than
   * applied as "no logo", which would be a different look under the kit's name.
   */
  const apply = async (kit: BrandKit) => {
    setProblem(null);
    setDone(null);
    setApplying(true);
    // Named field by field rather than handed the row: a kit on the wire carries an id and a
    // date the domain has no business reading, and an absent floor is absent rather than
    // present-and-nothing.
    const applied = applyKit({
      name: kit.name,
      style: kit.style,
      size: kit.size,
      logo: kit.logo,
      ...(kit.eclFloor === undefined ? {} : { eclFloor: kit.eclFloor }),
    });
    if (applied.logo === null) {
      onLogo(null);
    } else {
      const resolved = await resolveLogo(applied.logo);
      if (resolved.ok) {
        onLogo(resolved.logo);
      } else {
        setProblem(`The rest of the kit was applied. ${resolved.reason}`);
        onLogo(null);
      }
    }
    onStyle(applied.style);
    onEcl(applied.eclFloor);
    onPrintSize(applied.size);
    setApplying(false);
    announce(`The brand kit ${kit.name} was applied; the code is being checked again.`);
  };

  const save = async () => {
    if (typed === null) return;
    const checked = checkName(typed);
    if (!checked.ok) {
      setProblem(checked.reason);
      return;
    }
    setProblem(null);
    try {
      const kit = await keep({
        name: checked.name,
        style,
        eclFloor: ecl,
        size: printSize,
        logo: reference,
      });
      setTyped(null);
      setChosen(kit.id);
      setDone(`Saved the brand kit ${kit.name}`);
      announce(`Saved the brand kit ${kit.name}.`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const remove = async () => {
    if (selected === null) return;
    const { name } = selected;
    setProblem(null);
    setDone(null);
    try {
      await forget(selected.id);
      setConfirming(false);
      setChosen(null);
      announce(`The brand kit ${name} is gone.`);
    } catch (error) {
      setConfirming(false);
      setProblem(describeError(error));
    }
  };

  return (
    <Card
      title="Brand kit"
      description="A logo, a look and a size, kept under a name and applied to the next code in one click."
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-secondary">Apply a brand kit</span>
          <Select
            aria-label="Apply a brand kit"
            value={chosen ?? ''}
            disabled={applying || deleting || available.length === 0}
            onChange={(event) => {
              const kit = available.find((candidate) => candidate.id === event.target.value);
              setChosen(kit?.id ?? null);
              if (kit !== undefined) void apply(kit);
            }}
          >
            <option value="">Choose a kit…</option>
            {available.map((kit) => (
              <option key={kit.id} value={kit.id}>
                {kit.name}
              </option>
            ))}
          </Select>
        </label>

        {kits.isPending && <p className="text-caption text-fg-secondary">Reading your kits…</p>}
        {kits.isError && (
          <p className="text-caption text-fg-secondary">
            Your brand kits could not be listed. {describeError(kits.error)}
          </p>
        )}
        {kits.isSuccess && available.length === 0 && (
          <p className="text-caption text-fg-secondary">
            No kits yet. Save this look as one and the next code starts here.
          </p>
        )}

        {/* Naming happens in the card, not in a dialog: a kit is a look with a name on it. */}
        {typed === null ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={saving} onClick={() => setTyped('')}>
              Save as brand kit…
            </Button>
            {selected !== null && (
              <Button
                appearance="subtle"
                aria-label={`Delete kit ${selected.name}`}
                disabled={deleting}
                onClick={() => setConfirming(true)}
              >
                Delete kit
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">Kit name</span>
              <Input
                aria-label="Kit name"
                value={typed}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="House"
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save();
                  if (event.key === 'Escape') setTyped(null);
                }}
              />
            </label>
            <Button appearance="accent" disabled={saving} onClick={() => void save()}>
              Save kit
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                setTyped(null);
                setProblem(null);
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {done !== null && <InfoBar severity="success" title={done} />}

        {problem !== null && (
          <InfoBar severity="danger" title="The brand kit">
            {problem}
          </InfoBar>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={selected === null ? 'Delete this kit' : `Delete ${selected.name}`}
        confirmLabel="Delete"
        danger
        pending={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      >
        The look stays on the code you are working on. Only the kit is forgotten, and the logo it
        used stays in this workspace.
      </ConfirmDialog>
    </Card>
  );
}
