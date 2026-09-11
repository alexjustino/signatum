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

import { useMutation, useQuery } from '@tanstack/react-query';

import { exportPng, verifyCode } from './codes';
import { fetchAccentRamp, fetchSystemInfo } from './system';

export const keys = {
  systemInfo: ['system-info'] as const,
  accentRamp: ['accent-ramp'] as const,
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
