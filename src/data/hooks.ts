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

import { exportPng, verifyCode } from './codes';
import { deleteLogo, importLogo, listLogos, logoDataUrl } from './logos';
import { fetchAccentRamp, fetchSystemInfo } from './system';

export const keys = {
  systemInfo: ['system-info'] as const,
  accentRamp: ['accent-ramp'] as const,
  logos: ['logos'] as const,
  /** Under the logos key on purpose: forgetting a logo forgets its bytes too. */
  logoDataUrl: (id: string) => ['logos', id, 'data-url'] as const,
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
 */
export function useLogoDataUrl(id: string) {
  return useQuery({ queryKey: keys.logoDataUrl(id), queryFn: () => logoDataUrl(id) });
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
