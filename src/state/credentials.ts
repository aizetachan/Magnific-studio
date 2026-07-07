import { useSyncExternalStore } from "react";
import { config } from "@/config";

/**
 * GLOBAL credentials, shared across every project (not per-project). The
 * Anthropic API key, the director model and the connection status live here so
 * that connecting in Settings (which now lives in the Home dashboard) works in
 * any project you open in the Studio — switching projects no longer loses them.
 *
 * Kept in memory only (never written to disk / never exported), matching the
 * "session memory" promise; a full page reload starts fresh, same as before.
 */
export type ConnState = "untested" | "ok" | "failed";

export interface Credentials {
  anthropicApiKey: string;
  directorModel: string;
  connectionTested: ConnState;
}

let creds: Credentials = {
  anthropicApiKey: config.seed.anthropicApiKey,
  directorModel: config.seed.directorModel,
  connectionTested: "untested",
};

const subs = new Set<() => void>();

export function getCredentials(): Credentials {
  return creds;
}

export function setCredentials(patch: Partial<Credentials>): void {
  creds = { ...creds, ...patch };
  subs.forEach((fn) => fn());
}

export function subscribeCredentials(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** React hook: re-renders when the global credentials change. */
export function useCredentials(): Credentials {
  return useSyncExternalStore(subscribeCredentials, getCredentials, getCredentials);
}
