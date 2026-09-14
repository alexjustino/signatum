import type { ReactNode } from 'react';

import type { LogoBox } from '@/domain/logo';

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

/**
 * The logo, drawn over the code rather than inside it.
 *
 * The scene SVG carries the plate but never the logo: the host composes the two
 * when it rasterises, and the screen overlays them in the same place, in module
 * coordinates turned into percentages of the figure's square. One set of numbers,
 * two renderers — which is why what a person sees is what gets decoded.
 */
export interface CodeOverlay {
  dataUrl: string;
  box: LogoBox;
  /** Modules per side of the scene, quiet zone included — the percentage denominator. */
  side: number;
}

export function CodePreview({
  name,
  svg,
  overlay,
  caption,
  placeholder,
}: {
  name: string;
  /** The scene from `domain/scene.ts`, or null when there is nothing to show. */
  svg: string | null;
  overlay?: CodeOverlay | undefined;
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
        /* The square the code fills, and the box the overlay is positioned
           against: the SVG's viewBox is `side × side`, so a percentage of this
           element is a percentage of the code's own coordinate system. */
        <div className="relative w-full max-w-xs">
          <div
            className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            /* The only markup in this product injected as a string, and it is not
             foreign: it is the scene our own pure domain just serialised —
             `<rect>` and `<path>` inside one `<svg>`, with no script, no
             external reference and nothing a payload can reach. Rendering it as
             an <img> data URI instead would cost the crisp module edges and
             hide the code from the print path later. */
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {overlay !== undefined && (
            /* Decorative here on purpose: the figure's name already says what
               scanning does, and the logo does not change that sentence. */
            <img
              src={overlay.dataUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute object-contain"
              /* Geometry, not design: these come from the module coordinates the
                 domain computed, so they are the one thing on this surface that
                 is a number rather than a token. */
              style={{
                left: `${(overlay.box.x / overlay.side) * 100}%`,
                top: `${(overlay.box.y / overlay.side) * 100}%`,
                width: `${(overlay.box.width / overlay.side) * 100}%`,
                height: `${(overlay.box.height / overlay.side) * 100}%`,
              }}
            />
          )}
        </div>
      )}
      {caption !== undefined && (
        <figcaption className="w-full text-center text-caption text-fg-tertiary">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
