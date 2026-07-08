import { useSyncExternalStore } from "react";
import { config } from "@/config";

/**
 * GLOBAL credentials, shared across every project (not per-project). The
 * Anthropic API key, the director model and the connection status live here so
 * that connecting in Settings (which now lives in the Home dashboard) works in
 * any project you open in the Studio — switching projects no longer loses them.
 *
 * Alpha persistence: remembered in THIS BROWSER's localStorage so the user
 * doesn't re-paste the key on every visit. It still never travels to our
 * server (Anthropic is called directly from the browser) and is stripped from
 * project files and exports.
 */
export type ConnState = "untested" | "ok" | "failed";

export interface Credentials {
  anthropicApiKey: string;
  directorModel: string;
  connectionTested: ConnState;
}

const STORE_KEY = "magnific-studio:credentials";

function loadStored(): Partial<Credentials> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Credentials>;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        anthropicApiKey: creds.anthropicApiKey,
        directorModel: creds.directorModel,
        // "ok" is remembered so the UI doesn't ask to re-test every visit.
        connectionTested: creds.connectionTested === "ok" ? "ok" : "untested",
      }),
    );
  } catch {
    /* private mode / quota — stay in-memory only */
  }
}

const stored = loadStored();
let creds: Credentials = {
  anthropicApiKey: stored.anthropicApiKey ?? config.seed.anthropicApiKey,
  directorModel: stored.directorModel ?? config.seed.directorModel,
  connectionTested: stored.connectionTested === "ok" ? "ok" : "untested",
};

const subs = new Set<() => void>();

export function getCredentials(): Credentials {
  return creds;
}

export function setCredentials(patch: Partial<Credentials>): void {
  creds = { ...creds, ...patch };
  persist();
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
