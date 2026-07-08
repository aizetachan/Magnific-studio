/**
 * Local-first asset registry.
 *
 * Generated assets never live on the server: the backend streams each result
 * once (`/api/director/asset?job=`), the browser stores the bytes on the
 * user's machine (working folder if linked, else IndexedDB) and the app uses
 * a runtime `blob:` object URL everywhere — so no component needs to change.
 *
 * At the persistence boundary the volatile `blob:` URLs are swapped for
 * stable `local:assets/<file>` refs (dehydrate) and swapped back after load
 * (preload + hydrate). Old projects with plain http(s) URLs pass through
 * untouched.
 */

import { localDirStatus, readLocalFile, writeLocalFile } from "./localdir";

const LOCAL_PREFIX = "local:";

/** Filesystem/URL-safe slug for human-readable asset names. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ref ("local:assets/x.png") <-> runtime object URL, both directions.
const urlByRef = new Map<string, string>();
const refByUrl = new Map<string, string>();

// --- IndexedDB blob store (fallback when no working folder is linked) ---

const IDB_NAME = "magnific-studio-assets";
const IDB_STORE = "blobs";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutBlob(key: string, blob: Blob): Promise<void> {
  const db = await idb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGetBlob(key: string): Promise<Blob | null> {
  const db = await idb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// --- Storage backends: working folder first, IndexedDB otherwise ---

async function persistBlob(path: string, blob: Blob): Promise<void> {
  if (localDirStatus() === "ready" && (await writeLocalFile(path, blob))) return;
  await idbPutBlob(path, blob);
}

async function loadBlob(path: string): Promise<Blob | null> {
  if (localDirStatus() === "ready") {
    const f = await readLocalFile(path);
    if (f) return f;
  }
  try {
    return await idbGetBlob(path);
  } catch {
    return null;
  }
}

function extForType(ct: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("quicktime")) return ".mov";
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("ogg")) return ".ogg";
  return "";
}

function register(ref: string, blob: Blob): string {
  const prev = urlByRef.get(ref);
  if (prev) return prev;
  const u = URL.createObjectURL(blob);
  urlByRef.set(ref, u);
  refByUrl.set(u, ref);
  return u;
}

/** Store an in-memory blob on the user's machine; returns its object URL. */
export async function storeAssetBlob(
  name: string,
  blob: Blob,
  fallbackExt = ".bin",
): Promise<string> {
  const ext = extForType(blob.type) || fallbackExt;
  const safe = name.replace(/[\\/:*?"<>|]/g, "-");
  const path = `assets/${safe}${ext}`;
  await persistBlob(path, blob).catch(() => {});
  return register(`${LOCAL_PREFIX}${path}`, blob);
}

/**
 * Download a generated asset ONCE and store it on the user's machine; returns
 * the runtime object URL to use in the app. On failure, returns the source
 * URL unchanged (remote fallback — better a working remote ref than nothing).
 */
export async function materializeAsset(
  name: string,
  srcUrl: string,
): Promise<string> {
  try {
    const res = await fetch(srcUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`asset ${res.status}`);
    const blob = await res.blob();
    const fallbackExt =
      srcUrl.split("?")[0].match(/(\.[a-z0-9]{2,5})$/i)?.[1] ?? ".bin";
    return await storeAssetBlob(name, blob, fallbackExt);
  } catch {
    return srcUrl;
  }
}

/** Read a stored asset's bytes by its local ref path (for the Share relay). */
export async function loadLocalBlob(refPath: string): Promise<Blob | null> {
  const path = refPath.startsWith(LOCAL_PREFIX)
    ? refPath.slice(LOCAL_PREFIX.length)
    : refPath;
  return loadBlob(path);
}

/** Store an asset that arrived from a peer (Share) under its original path. */
export async function registerIncomingAsset(
  refPath: string,
  blob: Blob,
): Promise<void> {
  const path = refPath.startsWith(LOCAL_PREFIX)
    ? refPath.slice(LOCAL_PREFIX.length)
    : refPath;
  await persistBlob(path, blob).catch(() => {});
  register(`${LOCAL_PREFIX}${path}`, blob);
}

// --- Persistence-boundary transforms (deep string walk, mutating) ---

function walk(node: unknown, fn: (s: string) => string): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") node[i] = fn(v);
      else walk(v, fn);
    }
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") obj[k] = fn(v);
      else walk(v, fn);
    }
  }
}

/** Before saving: swap runtime blob: URLs for stable local: refs (mutates). */
export function dehydrateAssetRefs(p: unknown): void {
  walk(p, (s) => {
    if (!s.startsWith("blob:")) return s;
    // Unknown blob URLs are dead after reload — drop them rather than persist.
    return refByUrl.get(s) ?? "";
  });
}

/** Load the blobs behind every local: ref found in the project (into cache). */
export async function preloadLocalAssets(p: unknown): Promise<void> {
  const refs = new Set<string>();
  walk(structuredClone(p), (s) => {
    if (s.startsWith(LOCAL_PREFIX) && !urlByRef.has(s)) refs.add(s);
    return s;
  });
  await Promise.all(
    [...refs].map(async (ref) => {
      const blob = await loadBlob(ref.slice(LOCAL_PREFIX.length));
      if (blob) register(ref, blob);
    }),
  );
}

/**
 * After load: swap local: refs for runtime object URLs from the cache
 * (mutates; call preloadLocalAssets first). Returns whether anything changed.
 * Refs whose blob is missing are kept as-is so a later hydration can retry.
 */
export function hydrateAssetRefs(p: unknown): boolean {
  let changed = false;
  walk(p, (s) => {
    if (!s.startsWith(LOCAL_PREFIX)) return s;
    const u = urlByRef.get(s);
    if (!u) return s;
    changed = true;
    return u;
  });
  return changed;
}
