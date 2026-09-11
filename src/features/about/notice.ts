/**
 * Pull the third-party section out of NOTICE.
 *
 * The file lists them as `Name ..... Licence`, padded with dots so the plain
 * text lines up for anyone reading it in an editor. Parsing that back is a
 * small price for having exactly one list.
 */
export function thirdParty(text: string): Array<{ name: string; licence: string }> {
  const marker = text.indexOf('THIRD-PARTY COMPONENTS');
  if (marker === -1) return [];

  const credits: Array<{ name: string; licence: string }> = [];
  for (const line of text.slice(marker).split('\n')) {
    const match = /^\s{2}(\S.*?)\s*\.{3,}\s*(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const [, name, licence] = match;
    if (name !== undefined && licence !== undefined) credits.push({ name, licence });
  }
  return credits;
}
