/**
 * React Query bindings for the host commands.
 *
 * Commands are asynchronous I/O against a local process, which is what this
 * library is for: caching, invalidation and load state, without a hand-rolled
 * store per screen.
 *
 * The two scan-gate commands are mutations rather than queries, and not because
 * they change something here: they are requests about a code that exists only
 * in the window, made at a moment a person chose, and nothing else on any
 * screen wants to read the answer later. A cache key for them would be a key
 * nobody looks up.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cancelBatch, readTextFile, runBatch, writeBatchReport } from './batch';
import { copyPng, exportPdf, exportPng, exportSvg, scanMargin, verifyCode } from './codes';
import {
  deleteBrandKit,
  deleteCode,
  getCode,
  listBrandKits,
  listCodes,
  renameCode,
  saveBrandKit,
  saveCode,
} from './library';
import { deleteLogo, importLogo, listLogos, logoDataUrl } from './logos';
import { fetchAccentRamp, fetchSystemInfo } from './system';

export const keys = {
  systemInfo: ['system-info'] as const,
  accentRamp: ['accent-ramp'] as const,
  logos: ['logos'] as const,
  /** Under the logos key on purpose: forgetting a logo forgets its bytes too. */
  logoDataUrl: (id: string) => ['logos', id, 'data-url'] as const,
  codes: ['codes'] as const,
  /** Under the codes key: renaming or forgetting one has to reach the list as well. */
  code: (id: string) => ['codes', id] as const,
  brandKits: ['brand-kits'] as const,
};

/** What the running binary says about itself. Read once: it does not change. */
export function useSystemInfo() {
  return useQuery({ queryKey: keys.systemInfo, queryFn: fetchSystemInfo });
}

/** The ramp Windows gave for the user's accent colour. */
export function useAccentRamp() {
  return useQuery({ queryKey: keys.accentRamp, queryFn: fetchAccentRamp });
}

/** Ask the host to render and decode a code, without writing anything. */
export function useVerifyCode() {
  return useMutation({ mutationFn: verifyCode });
}

/** Ask the host to write a code — which it does only if it decoded it first. */
export function useExportPng() {
  return useMutation({ mutationFn: exportPng });
}

/** The same file, as the vector the print shop asks for. */
export function useExportSvg() {
  return useMutation({ mutationFn: exportSvg });
}

/** The same code as a page, measured in millimetres. */
export function useExportPdf() {
  return useMutation({ mutationFn: exportPdf });
}

/** The verified picture on the clipboard — the image, never the payload text. */
export function useCopyPng() {
  return useMutation({ mutationFn: copyPng });
}

/**
 * How far the code can be degraded and still read.
 *
 * A mutation although it writes nothing, for the reason the two gate commands
 * are: it is a question about a code that exists only in this window, asked at a
 * moment the screen chose — 400 ms after a verdict — and nothing else ever wants
 * to read the answer back. A cache key for it would be a key nobody looks up.
 */
export function useScanMargin() {
  return useMutation({ mutationFn: scanMargin });
}

/**
 * The logos already imported into this workspace.
 *
 * The one query in the product that is not read once. Everywhere else this
 * window is the only writer, so a timer would be a lie about where the data
 * comes from; the logo store is a table on disk that a command can also fill
 * without going through this screen, and a card that offers a logo for reuse
 * has to be offering what is really there. It is a handful of rows without
 * their bytes, and it stops while the window is not being looked at.
 */
export function useLogos() {
  return useQuery({
    queryKey: keys.logos,
    queryFn: listLogos,
    staleTime: 0,
    refetchInterval: 1500,
    refetchIntervalInBackground: false,
  });
}

/**
 * The stored bytes of one logo, for showing it. They never change for a given
 * id — the store writes a logo once — so this is fetched at most once a window.
 *
 * `null` is "there is no logo here": a saved code without one is a row that asks
 * nothing of the store, and the question is not asked rather than asked about
 * nothing. Written as a disabled query rather than as a second hook, because a
 * hook that is sometimes called is the crash `rules-of-hooks` exists to prevent.
 */
export function useLogoDataUrl(id: string | null) {
  return useQuery({
    queryKey: keys.logoDataUrl(id ?? 'none'),
    // Never runs while `enabled` is false; the branch is for the type, not for the host.
    queryFn: () => (id === null ? Promise.resolve(null) : logoDataUrl(id)),
    enabled: id !== null,
  });
}

/**
 * Import a file as a logo. This one is a mutation with a cache behind it: the
 * store really did change, and the list of logos a person can reuse has to say
 * so without being asked again.
 */
export function useImportLogo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: importLogo,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.logos }),
  });
}

/** Forget a logo, and the list with it. */
export function useDeleteLogo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteLogo,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.logos }),
  });
}

/**
 * The saved codes (SPEC §2.7).
 *
 * Read once and invalidated by the three commands that change them, rather than polled like the
 * logos: this window is the only thing that writes the library, so a timer would be a claim
 * about a writer that does not exist.
 */
export function useCodes() {
  return useQuery({ queryKey: keys.codes, queryFn: listCodes });
}

/** One saved code in full: the fields a row draws its preview from, and Open loads. */
export function useCode(id: string) {
  return useQuery({ queryKey: keys.code(id), queryFn: () => getCode(id) });
}

/** Keep the code on screen. The list says so without being asked again. */
export function useSaveCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveCode,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.codes }),
  });
}

/** Give a saved code another name. */
export function useRenameCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: renameCode,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.codes }),
  });
}

/** Forget a saved code — and with it whatever a row of it was showing. */
export function useDeleteCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteCode,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.codes }),
  });
}

/** The brand kits: a look, a size and a logo, each under a name. */
export function useBrandKits() {
  return useQuery({ queryKey: keys.brandKits, queryFn: listBrandKits });
}

export function useSaveBrandKit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveBrandKit,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.brandKits }),
  });
}

/**
 * Forget a brand kit. The logos are invalidated with it: a kit was one of the reasons the store
 * refused to forget a logo, and the row that offers to forget it has to stop saying so.
 */
export function useDeleteBrandKit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteBrandKit,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.brandKits });
      await client.invalidateQueries({ queryKey: keys.logos });
    },
  });
}

/**
 * The four batch commands (F9), all mutations.
 *
 * Nothing here is cached, and for the reason the scan-gate commands are not: a batch is an act a
 * person asked for at a moment, against a folder they chose at that moment, and its answer is
 * about that act. A cache key for it would be a key nobody looks up — and a second run of the
 * same CSV into the same folder is a different event, not a stale copy of the first.
 */

/** Read the chosen CSV. The host reads files; this interface never does. */
export function useReadTextFile() {
  return useMutation({ mutationFn: readTextFile });
}

/** Write the planned rows into the chosen folder, each one through the gate. */
export function useRunBatch() {
  return useMutation({ mutationFn: runBatch });
}

/** Stop after the row being written; the rest come back as skipped. */
export function useCancelBatch() {
  return useMutation({ mutationFn: cancelBatch });
}

/** Write the report the domain composed, beside the codes it is about. */
export function useWriteBatchReport() {
  return useMutation({ mutationFn: writeBatchReport });
}
