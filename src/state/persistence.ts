/**
 * Local-per-machine, multi-project persistence.
 *
 * Each project is stored under its own key (`ms:project:<id>`) so several tabs
 * can hold different projects without clobbering each other. The tab's project
 * is chosen by the `?p=<id>` URL param; a `ms:last` pointer remembers the most
 * recent one. Secrets and half-finished jobs are never persisted.
 */

import type { Job, Project } from "@/types/project";
import { uid } from "./seed";

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

const STARRED = "magnific-studio:starred";
const TRASH = "magnific-studio:trash";

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** Favorites (starred projects), per machine. */
export function getStarred(): Set<string> {
  return readSet(STARRED);
}
export function toggleStar(id: string): void {
  const s = readSet(STARRED);
  s.has(id) ? s.delete(id) : s.add(id);
  writeSet(STARRED, s);
}

/** Soft-delete (trash) — the project data stays until permanently deleted. */
export function getTrash(): Set<string> {
  return readSet(TRASH);
}
export function trashProject(id: string): void {
  const s = readSet(TRASH);
  s.add(id);
  writeSet(TRASH, s);
}
export function restoreProject(id: string): void {
  const s = readSet(TRASH);
  s.delete(id);
  writeSet(TRASH, s);
}
export function deleteProjectForever(id: string): void {
  restoreProject(id);
  const st = readSet(STARRED);
  st.delete(id);
  writeSet(STARRED, st);
  clearProject(id);
}

/** Lightweight list of all locally-stored projects (for the switcher/dashboard). */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
}
function summarize(keep: (id: string) => boolean): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        const p = JSON.parse(localStorage.getItem(key) ?? "") as Project;
        if (p?.id && keep(p.id)) {
          out.push({ id: p.id, name: p.name || "Proyecto sin título", createdAt: p.createdAt ?? 0 });
        }
      } catch {
        /* skip a corrupt entry */
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
/** All non-trashed projects (most recent first). */
export function listProjects(): ProjectSummary[] {
  const trash = readSet(TRASH);
  return summarize((id) => !trash.has(id));
}
/** Trashed projects only. */
export function listTrashedProjects(): ProjectSummary[] {
  const trash = readSet(TRASH);
  return summarize((id) => trash.has(id));
}

/** Deterministic gradient for a project's color chip (derived from its id). */
export function projectColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 75% 60%), hsl(${(h + 40) % 360} 80% 50%))`;
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

/** Rename a project by id (without loading it into the store). */
export function renameProject(id: string, name: string): void {
  const p = loadProject(id);
  if (!p) return;
  p.name = name.trim() || "Proyecto sin título";
  saveProject(p);
}

/** Duplicate a project; returns the new id. */
export function duplicateProject(id: string): string | null {
  const p = loadProject(id);
  if (!p) return null;
  const copy = structuredClone(p) as Project;
  copy.id = uid("proj");
  copy.name = `${p.name} (copia)`;
  copy.createdAt = Date.now();
  saveProject(copy);
  return copy.id;
}

export function clearProject(id: string): void {
  try {
    localStorage.removeItem(keyFor(id));
  } catch {
    /* ignore */
  }
}
