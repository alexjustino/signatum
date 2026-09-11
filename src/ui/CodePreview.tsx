import type { ReactNode } from 'react';

/**
 * The code, as it will be printed (DESIGN_SYSTEM §2, "Colour and the code").
 *
 * The frame is themed and the inside of it is not. The code's own two colours
 * are the colours somebody chose to print, they arrive inside the SVG itself,
 * and they are identical in light and in dark — a preview whose shade followed
 * the application's theme would be a preview of something that will never exist
 * on paper.
 *
 * The accessible name is the caller's, and it says what scanning will do:
 * "QR code that opens example.com". A figure named "preview" or "QR code" tells
 * a person who cannot see it nothing they did not already know.
 */
export function CodePreview({
  name,
  svg,
  caption,
  placeholder,
}: {
  name: string;
  /** The scene from `domain/scene.ts`, or null when there is nothing to show. */
  svg: string | null;
  caption?: ReactNode;
  placeholder?: ReactNode;
}) {
  return (
    <figure
      aria-label={name}
      className="flex flex-col items-center gap-3 rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
    >
      {svg === null ? (
        <div className="w-full">{placeholder}</div>
      ) : (
        <div
          className="w-full max-w-xs [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          /* The only markup in this product injected as a string, and it is not
             foreign: it is the scene our own pure domain just serialised —
             `<rect>` and `<path>` inside one `<svg>`, with no script, no
             external reference and nothing a payload can reach. Rendering it as
             an <img> data URI instead would cost the crisp module edges and
             hide the code from the print path later. */
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {caption !== undefined && (
        <figcaption className="w-full text-center text-caption text-fg-tertiary">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
