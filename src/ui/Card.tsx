import type { ReactNode } from 'react';

/**
 * An opaque surface inside the layer, at the first step of elevation.
 *
 * `label` names the section itself, for a screen whose cards are a list of things rather than one
 * of a kind — "Code 1", "Code 2" — so a person moving by region hears which one they are in
 * before they start reading it (DESIGN_SYSTEM §7). Optional, because a card that is the only one
 * of its kind is already named by its heading.
 */
export function Card({
  label,
  title,
  description,
  actions,
  children,
}: {
  label?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
    >
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-body-lg font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-caption text-fg-tertiary">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
