import {
  DocumentTable20Regular,
  Info20Regular,
  Library20Regular,
  QrCode20Regular,
  ScanCamera20Regular,
  Settings20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';

import { DESTINATIONS, DESTINATION_LABELS, type Destination } from '@/features/shell/destinations';

/**
 * The navigation rail.
 *
 * Every destination here is built. A destination that is planned and not
 * built is not listed — nothing on the rail pretends to work when it does not.
 */

const ICONS: Record<Destination, ReactNode> = {
  create: <QrCode20Regular />,
  library: <Library20Regular />,
  batch: <DocumentTable20Regular />,
  read: <ScanCamera20Regular />,
  diagnostics: <Wrench20Regular />,
  settings: <Settings20Regular />,
  about: <Info20Regular />,
};

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Destination;
  onNavigate: (destination: Destination) => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-stroke-subtle bg-layer-alt p-2"
    >
      {DESTINATIONS.map((destination) => {
        const selected = destination === active;
        const label = DESTINATION_LABELS[destination];
        return (
          <button
            key={destination}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onNavigate(destination)}
            title={label}
            className={[
              'flex h-(--density-row) items-center gap-3 rounded-md px-3 text-body',
              'transition-colors duration-100 ease-easy hover:bg-card-hover',
              selected ? 'bg-accent-subtle font-semibold text-fg' : 'text-fg-secondary',
            ].join(' ')}
          >
            <span aria-hidden="true" className={selected ? 'text-accent' : undefined}>
              {ICONS[destination]}
            </span>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
