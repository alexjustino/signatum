/**
 * The destinations, and what each one calls itself.
 *
 * Kept beside the rail rather than inside it so the shell can name the region a
 * destination opens into with the same word the navigation used to get there —
 * which is what DESIGN_SYSTEM §7 asks of every screen and every scrolling
 * region — without importing a component to read a label.
 */

export type Destination = 'create' | 'library' | 'batch' | 'diagnostics' | 'settings' | 'about';

/** The order of the rail. */
export const DESTINATIONS: readonly Destination[] = [
  'create',
  'library',
  'batch',
  'diagnostics',
  'settings',
  'about',
];

export const DESTINATION_LABELS: Record<Destination, string> = {
  create: 'Create',
  library: 'Library',
  batch: 'Batch',
  diagnostics: 'Diagnostics',
  settings: 'Settings',
  about: 'About',
};
