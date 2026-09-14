import { Copy20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import mark from '@/assets/mark.svg';

import { describeError } from '@/data/errors';
import { useSystemInfo } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

// The credits are read from NOTICE itself rather than retyped here. Two lists
// of the same thing drift, and the one that drifts is always the one a person
// actually reads.
import notice from '../../../NOTICE?raw';

import { thirdParty } from './notice';

const REPOSITORY = 'https://github.com/alexjustino/signatum';

/**
 * About.
 *
 * Not a version number in a corner. This is where the product says what it is,
 * who made it, what it is licensed under, whose trademarks it names and what it
 * is built on — which is the least a piece of software owes the person running
 * it.
 */
export function AboutPage() {
  const system = useSystemInfo();
  const info = system.data ?? null;
  const [copied, setCopied] = useState(false);

  const credits = thirdParty(notice);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header className="flex items-center gap-4">
        <img src={mark} alt="" width={64} height={64} draggable={false} className="rounded-xl" />
        <div>
          {/* The screen is named with the word the navigation used to reach it
              (DESIGN_SYSTEM §7), and with the product's name, because this is
              the one screen whose subject is the product. */}
          <h1 className="font-display text-display font-semibold text-fg">About Signatum</h1>
          <p className="mt-1 text-body-lg text-fg-secondary">
            A code studio that proves a code scans before it lets it out. It runs on this machine
            and nowhere else.
          </p>
        </div>
      </header>

      {/* ── The name ─────────────────────────────────────────────────────── */}
      <Card title="The name">
        <div className="flex flex-col gap-3 text-body text-fg-secondary">
          <p>
            <strong className="font-semibold text-fg">Signatum</strong> is Latin — the neuter
            participle of <em>signare</em>, to mark, to seal, to sign:{' '}
            <em>what has been marked and sealed</em>.
          </p>
          <p>
            <em>Aes signatum</em> was Rome&rsquo;s first stamped bronze: metal that carried the
            state&rsquo;s mark as proof of its own weight. Not a decoration pressed onto the surface
            — a mark that certified the thing it was on.
          </p>
          <p className="border-l-2 border-accent pl-3 text-fg">
            A mark that certifies. That is a code nobody exported until a decoder read it back.
          </p>
        </div>
      </Card>

      {/* ── This build ───────────────────────────────────────────────────── */}
      <Card
        title="This build"
        description="Read from the running binary, never from a constant typed by hand."
      >
        {system.error ? (
          <InfoBar severity="danger" title="The host did not answer">
            {describeError(system.error)}
          </InfoBar>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label="Version" value={info?.version ?? '…'} />
            <Row label="Commit" value={__GIT_COMMIT__} mono />
            <Row label="Built" value={__BUILD_DATE__} />
            <Row label="Workspace schema" value={info ? String(info.schemaVersion) : '…'} />
            <Row label="Platform" value={info?.platform ?? '…'} />
          </dl>
        )}
      </Card>

      {/* ── Author and licence ───────────────────────────────────────────── */}
      <Card title="Author and licence">
        <div className="flex flex-col gap-3 text-body text-fg-secondary">
          <p>
            Made by <strong className="font-semibold text-fg">Alex Justino</strong>.
          </p>
          <p>
            Copyright 2026 Alex Justino. Licensed under the{' '}
            <strong className="font-semibold text-fg">Apache License 2.0</strong>. You may use,
            modify and redistribute this software under its terms; a redistributed copy keeps this
            notice and says that it was modified.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* The address is copied, not opened. This product has no way to
                reach the network and does not acquire one to show a link: the
                address is here to be read and taken elsewhere. */}
            <Button
              icon={<Copy20Regular />}
              onClick={() => {
                void navigator.clipboard.writeText(REPOSITORY);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy the address'}
            </Button>
            <span data-selectable className="font-mono text-caption text-fg-tertiary">
              {REPOSITORY}
            </span>
          </div>
        </div>
      </Card>

      {/* ── Trademarks ───────────────────────────────────────────────────── */}
      <Card title="Trademarks" description="The same words as the NOTICE file that ships.">
        <div className="flex flex-col gap-2 text-body text-fg-secondary">
          <p>
            &ldquo;Signatum&rdquo; is a trademark of Alex Justino. The licence covers the source
            code; it does not grant permission to use the project name or wordmark to endorse or
            promote derived products.
          </p>
          <p>
            &ldquo;QR Code&rdquo; is a registered trademark of DENSO WAVE INCORPORATED. Signatum is
            not affiliated with or endorsed by DENSO WAVE.
          </p>
        </div>
      </Card>

      {/* ── Privacy ──────────────────────────────────────────────────────── */}
      <Card title="Your data">
        <div className="flex flex-col gap-2 text-body text-fg-secondary">
          <p>
            Signatum makes no network requests. There is no account, no sync, no analytics, no crash
            reporting and no update check — and it never contacts the address a code opens. Nothing
            you make here leaves this machine.
          </p>
          {info !== null && (
            <p className="font-mono text-caption break-all text-fg-tertiary" data-selectable>
              {info.databasePath}
            </p>
          )}
          <p className="text-caption">That file is yours: copy it, or back it up.</p>
        </div>
      </Card>

      {/* ── Credits ──────────────────────────────────────────────────────── */}
      <Card
        title="Built on"
        description="Read from the project's NOTICE file, so this list cannot drift from the one that ships."
      >
        {credits.length === 0 ? (
          <p className="text-body text-fg-tertiary">
            The third-party list could not be read from NOTICE.
          </p>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-body">
            {credits.map((credit) => (
              <Row key={credit.name} label={credit.name} value={credit.licence} />
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
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
