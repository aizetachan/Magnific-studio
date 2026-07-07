/**
 * Local working-directory persistence (File System Access API).
 *
 * The user picks a folder once ("carpeta de trabajo"); projects and generated
 * assets are written there so ALL content lives on the user's machine — the
 * server never stores it. The directory handle survives reloads via IndexedDB,
 * but the browser requires a one-click permission re-grant per session.
 *
 * Layout inside the chosen folder:
 *   <root>/<projectId>/project.json
 *   <root>/<projectId>/assets/<filename>
 *
 * Only Chromium (Chrome/Edge/Opera) implements showDirectoryPicker. On other
 * browsers `supportsLocalDir()` is false and the app stays on the localStorage
 * + export-ZIP flow.
 */

// --- Ambient types: WICG File System Access bits missing from lib.dom ---
type FSPermissionMode = "read" | "readwrite";
interface FSHandlePermissions {
  queryPermission?(desc: { mode: FSPermissionMode }): Promise<PermissionState>;
  requestPermission?(desc: { mode: FSPermissionMode }): Promise<PermissionState>;
}
declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: FSPermissionMode;
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle extends FSHandlePermissions {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

export type LocalDirStatus =
  | "unsupported" // Safari/Firefox — no folder mode
  | "unlinked" // supported, no folder chosen yet
  | "needs-permission" // folder remembered, browser wants a re-grant click
  | "ready"; // folder linked and writable

// --- IndexedDB persistence of the directory handle ---

const IDB_NAME = "magnific-studio-localdir";
const IDB_STORE = "handles";
const IDB_KEY = "workdir";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await idb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// --- Handle lifecycle ---

let rootHandle: FileSystemDirectoryHandle | null = null;
let status: LocalDirStatus = supportsLocalDir() ? "unlinked" : "unsupported";
const listeners = new Set<() => void>();

function setStatus(next: LocalDirStatus): void {
  if (status === next) return;
  status = next;
  for (const fn of listeners) fn();
}

export function supportsLocalDir(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function localDirStatus(): LocalDirStatus {
  return status;
}

export function subscribeLocalDir(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Name of the linked folder (for UI), or null. */
export function localDirName(): string | null {
  return rootHandle?.name ?? null;
}

async function hasPermission(
  handle: FileSystemDirectoryHandle,
  ask: boolean,
): Promise<boolean> {
  try {
    const q = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (q === "granted") return true;
    if (!ask) return false;
    const r = (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    return r === "granted";
  } catch {
    return false;
  }
}

/**
 * Restore the remembered folder on startup. Does NOT prompt (no user gesture
 * yet): if the browser wants a re-grant, status becomes "needs-permission" and
 * the UI shows a "Reconectar carpeta" button that calls requestAccess().
 * Idempotent — safe to call from several mount points.
 */
let initPromise: Promise<LocalDirStatus> | null = null;
export function initLocalDir(): Promise<LocalDirStatus> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<LocalDirStatus> {
  if (!supportsLocalDir()) return status;
  try {
    const saved = await idbGet<FileSystemDirectoryHandle>(IDB_KEY);
    if (!saved) {
      setStatus("unlinked");
      return status;
    }
    rootHandle = saved;
    setStatus((await hasPermission(saved, false)) ? "ready" : "needs-permission");
  } catch {
    setStatus("unlinked");
  }
  return status;
}

/** Re-grant access to the remembered folder (must run in a user gesture). */
export async function requestAccess(): Promise<boolean> {
  if (!rootHandle) return false;
  const ok = await hasPermission(rootHandle, true);
  setStatus(ok ? "ready" : "needs-permission");
  return ok;
}

/** Ask the user to pick the working folder (must run in a user gesture). */
export async function pickDirectory(): Promise<boolean> {
  if (!supportsLocalDir() || !window.showDirectoryPicker) return false;
  try {
    const handle = await window.showDirectoryPicker({
      id: "magnific-studio-workdir",
      mode: "readwrite",
    });
    rootHandle = handle;
    await idbSet(IDB_KEY, handle);
    setStatus("ready");
    return true;
  } catch {
    return false; // user cancelled the picker
  }
}

/** Forget the linked folder (files on disk are left untouched). */
export async function unlinkDirectory(): Promise<void> {
  rootHandle = null;
  await idbDelete(IDB_KEY).catch(() => {});
  setStatus(supportsLocalDir() ? "unlinked" : "unsupported");
}

// --- File operations (paths are "/"-separated, relative to the root) ---

async function dirFor(
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  if (!rootHandle || status !== "ready") return null;
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  let dir = rootHandle;
  try {
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, name };
  } catch {
    return null;
  }
}

/** Write text or binary content, creating parent folders as needed. */
export async function writeLocalFile(
  path: string,
  data: Blob | string,
): Promise<boolean> {
  const at = await dirFor(path, true);
  if (!at) return false;
  try {
    const file = await at.dir.getFileHandle(at.name, { create: true });
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
    return true;
  } catch {
    return false;
  }
}

export async function readLocalFile(path: string): Promise<File | null> {
  const at = await dirFor(path, false);
  if (!at) return null;
  try {
    const file = await at.dir.getFileHandle(at.name);
    return await file.getFile();
  } catch {
    return null;
  }
}

export async function deleteLocalFile(path: string): Promise<boolean> {
  const at = await dirFor(path, false);
  if (!at) return false;
  try {
    await at.dir.removeEntry(at.name);
    return true;
  } catch {
    return false;
  }
}

/** List immediate subdirectory names of the root (project folders). */
export async function listLocalDirs(): Promise<string[]> {
  if (!rootHandle || status !== "ready") return [];
  const out: string[] = [];
  try {
    for await (const [name, entry] of rootHandle.entries()) {
      if (entry.kind === "directory") out.push(name);
    }
  } catch {
    /* ignore */
  }
  return out;
}

// --- Project-level helpers (layout: <projectId>/project.json + assets/) ---

export const projectJsonPath = (projectId: string) => `${projectId}/project.json`;
export const assetPath = (projectId: string, filename: string) =>
  `${projectId}/assets/${filename}`;
