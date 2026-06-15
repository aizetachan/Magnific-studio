/**
 * Local-per-machine, multi-project persistence.
 *
 * Each project is stored under its own key (`ms:project:<id>`) so several tabs
 * can hold different projects without clobbering each other. The tab's project
 * is chosen by the `?p=<id>` URL param; a `ms:last` pointer remembers the most
 * recent one. Secrets and half-finished jobs are never persisted.
 */

import type { Job, Project } from "@/types/project";

const PREFIX = "magnific-studio:project:";
const LAST = "magnific-studio:last";
const LEGACY_KEY = "magnific-studio:project:v1"; // single-project (pre multi-project)
const keyFor = (id: string) => `${PREFIX}${id}`;

/** One-time migration of the old single-project storage to the by-id scheme. */
function migrateLegacy(): string | undefined {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Project;
    if (!p?.id) return undefined;
    localStorage.setItem(keyFor(p.id), raw);
    localStorage.setItem(LAST, p.id);
    if (keyFor(p.id) !== LEGACY_KEY) localStorage.removeItem(LEGACY_KEY);
    return p.id;
  } catch {
    return undefined;
  }
}

/** Keep settled jobs, plus "rendering" jobs that can be resumed (have a backendJobId). */
function settledOnly(job?: Job): Job | undefined {
  if (!job) return undefined;
  if (job.status === "queued") return undefined; // never started on the backend
  if (job.status === "rendering" && !job.backendJobId) return undefined;
  return job;
}

/** A copy safe to persist: no secrets, no half-finished jobs. */
function sanitize(p: Project): Project {
  const safe = structuredClone(p) as Project;
  safe.settings.anthropicApiKey = "";
  safe.settings.magnificApiKey = "";
  for (const s of safe.shots) {
    s.keyframeJob = settledOnly(s.keyframeJob);
    s.videoJob = settledOnly(s.videoJob);
  }
  for (const tr of safe.audio ?? []) {
    tr.job = settledOnly(tr.job);
  }
  safe.delivery.finalVideoJob = settledOnly(safe.delivery.finalVideoJob);
  return safe;
}

/** The project id this tab should load: URL `?p=`, else the last-used one. */
export function currentProjectId(): string | undefined {
  try {
    const p = new URLSearchParams(window.location.search).get("p");
    if (p) return p;
    const last = localStorage.getItem(LAST);
    if (last) return last;
    return migrateLegacy();
  } catch {
    return undefined;
  }
}

/** Reflect the active project id in the URL (so a reload/share reopens it). */
export function setUrlProject(id: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("p") !== id) {
      url.searchParams.set("p", id);
      window.history.replaceState({}, "", url);
    }
  } catch {
    /* ignore */
  }
}

export function loadProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(keyFor(id));
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

export function saveProject(p: Project): void {
  try {
    localStorage.setItem(keyFor(p.id), JSON.stringify(sanitize(p)));
    localStorage.setItem(LAST, p.id);
  } catch {
    // Quota exceeded or serialization issue — keep the app working regardless.
  }
}

export function clearProject(id: string): void {
  try {
    localStorage.removeItem(keyFor(id));
  } catch {
    /* ignore */
  }
}
