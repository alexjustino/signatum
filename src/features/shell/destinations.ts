/**
 * The destinations, and what each one calls itself.
 *
 * Kept beside the rail rather than inside it so the shell can name the region a
 * destination opens into with the same word the navigation used to get there —
 * which is what DESIGN_SYSTEM §7 asks of every screen and every scrolling
 * region — without importing a component to read a label.
 */

export type Destination =
  'create' | 'library' | 'batch' | 'read' | 'diagnostics' | 'settings' | 'about';

/**
 * The order of the rail: the work first, then the three that are about the product itself.
 */
export const DESTINATIONS: readonly Destination[] = [
  'create',
  'library',
  'batch',
  'read',
  'diagnostics',
  'settings',
  'about',
];

/**
 * Where the rail draws its one separator (F11): before the trio that is about the product
 * rather than about a code. It is named here, beside the order it divides, so the rail draws
 * the grouping rather than deciding it — and so a destination inserted into the list above
 * cannot silently land on the wrong side of the line.
 */
export const RAIL_SEPARATOR_BEFORE: Destination = 'diagnostics';

export const DESTINATION_LABELS: Record<Destination, string> = {
  create: 'Create',
  library: 'Library',
  batch: 'Batch',
  read: 'Read',
  diagnostics: 'Diagnostics',
  settings: 'Settings',
  about: 'About',
};
