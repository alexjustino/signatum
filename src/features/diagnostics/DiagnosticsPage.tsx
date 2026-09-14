import { useEffect } from 'react';

import { applyAccent } from '@/app/theme';
import { describeError } from '@/data/errors';
import { useAccentRamp, useBrandKits, useCodes, useSystemInfo } from '@/data/hooks';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

/**
 * Diagnostics.
 *
 * It exists to make the product's claims checkable rather than asserted: the
 * host is reachable, the database migrated and where it is, the accent colour
 * really the one Windows gave. What a person changes lives in Settings; this
 * page only shows.
 */
export function DiagnosticsPage() {
  const info = useSystemInfo();
  const accent = useAccentRamp();
  const codes = useCodes();
  const kits = useBrandKits();
  const ramp = accent.data ?? null;

  // Reading the ramp here is also the moment to apply it: a person who opens
  // this page after changing their Windows accent should see the product follow
  // it, not read a number that disagrees with the window around it.
  useEffect(() => {
    if (ramp !== null) applyAccent(ramp);
  }, [ramp]);

  const failure = info.error ?? accent.error;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Diagnostics</h1>
        <p className="mt-1 text-body text-fg-secondary">
          What the product claims, shown rather than asserted.
        </p>
      </header>

      {failure && (
        <InfoBar severity="danger" title="The host did not answer">
          {describeError(failure)}
        </InfoBar>
      )}

      <Card title="Workspace" description="Read from the running binary, never a typed constant.">
        {info.data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label="Version" value={info.data.version} />
            <Row
              label="Schema"
              value={
                info.data.schemaVersion === info.data.expectedSchemaVersion
                  ? `${info.data.schemaVersion} (up to date)`
                  : `${info.data.schemaVersion}, expected ${info.data.expectedSchemaVersion}`
              }
            />
            <Row label="Platform" value={info.data.platform} />
            <Row label="Database" value={info.data.databasePath} mono />
            <Row label="Size" value={`${info.data.databaseBytes.toLocaleString()} bytes`} />
          </dl>
        ) : (
          <div className="h-24 animate-pulse rounded-md bg-card-hover" />
        )}
        {info.data?.databaseRelocated && (
          <p className="mt-3 text-caption text-fg-tertiary">
            This workspace was relocated by SIGNATUM_DATA_DIR — it is not the usual one.
          </p>
        )}
      </Card>

      <Card title="Library" description="What this workspace is keeping for you.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <Row label="Saved codes" value={counted(codes.data?.length, codes.isError)} />
          <Row label="Brand kits" value={counted(kits.data?.length, kits.isError)} />
        </dl>
      </Card>

      <Card title="Accent" description="The ramp Windows gave for your accent colour.">
        <div className="flex overflow-hidden rounded-md border border-stroke-subtle">
          {ramp
            ? [
                ramp.dark3,
                ramp.dark2,
                ramp.dark1,
                ramp.accent,
                ramp.light1,
                ramp.light2,
                ramp.light3,
              ].map((hex) => (
                <div
                  key={hex}
                  className="h-10 flex-1"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))
            : null}
        </div>
        {ramp && !ramp.fromSystem && (
          <p className="mt-2 text-caption text-fg-tertiary">
            This is the built-in default, not your Windows setting — the system could not be asked.
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * A count, or what is true instead of one.
 *
 * A number that could not be read must not be shown as zero: an empty library and an unanswered
 * question look identical, and only one of them is a fact (DESIGN_SYSTEM §2).
 */
function counted(total: number | undefined, failed: boolean): string {
  if (failed) return 'could not be read';
  return total === undefined ? 'reading…' : total.toLocaleString();
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd
        data-selectable
        className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}
