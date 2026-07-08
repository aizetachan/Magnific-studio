/**
 * ShareRoom — one RTDB "room" per shared project (Fase 0.5).
 *
 * The room is an EPHEMERAL relay: entity patches + a rolling snapshot for
 * catch-up, presence and field locks (cleared onDisconnect), and asset bytes
 * relayed as base64 chunks so every participant stores their own local copy.
 * Nothing here is a durable content store: patches are pruned as the snapshot
 * advances and asset chunks are deleted after delivery.
 *
 * Room ids are unguessable capability tokens (validation-phase access model;
 * see database.rules.json).
 */

import {
  child,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  startAfter,
  orderByKey,
  type DatabaseReference,
  type Unsubscribe,
} from "firebase/database";
import { rtdb } from "./db";
import type { SyncOp } from "./diff";

export interface RoomPatch {
  rev: number;
  uid: string;
  ops: SyncOp[];
}

/** Wire form: ops are JSON-encoded because RTDB strips empty arrays/objects,
 * which corrupted entities (e.g. characters: [] vanished → .map crashes). */
interface WirePatch {
  rev: number;
  uid: string;
  opsJson?: string;
  /** Legacy field from builds that stored ops structurally. */
  ops?: SyncOp[];
}

export interface PresenceEntry {
  uid: string;
  email: string;
  name?: string;
  photo?: string;
  activeSceneId?: string | null;
}

export interface LockEntry {
  path: string;
  uid: string;
  email: string;
}

/** Keys RTDB rejects (., /, #, $, [, ]) — encode arbitrary paths base64url. */
const encKey = (s: string) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decKey = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

const r0 = (root: DatabaseReference, path: string) => child(root, `locks/${encKey(path)}`);

const CHUNK = 192 * 1024; // base64-safe chunk of the underlying bytes
const SNAPSHOT_EVERY = 15; // refresh the catch-up snapshot every N revs

function blobToB64(blob: Blob): Promise<string[]> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      let bin = "";
      const slice = bytes.subarray(i, i + CHUNK);
      for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
      chunks.push(btoa(bin));
    }
    return chunks;
  });
}

function b64ToBlob(chunks: string[], type: string): Blob {
  const parts = chunks.map((c) => {
    const bin = atob(c);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  });
  return new Blob(parts as BlobPart[], { type });
}

export class ShareRoom {
  private root: DatabaseReference;
  private subs: Unsubscribe[] = [];
  private lastSeenPatchKey: string | null = null;

  constructor(
    readonly roomId: string,
    private uid: string,
    private email: string,
    private name?: string,
    private photo?: string,
  ) {
    this.root = ref(rtdb(), `rooms/${roomId}`);
  }

  private presenceValue(activeSceneId: string | null = null) {
    return {
      email: this.email,
      name: this.name ?? null,
      photo: this.photo ?? null,
      activeSceneId,
      at: serverTimestamp(),
    };
  }

  // --- membership / lifecycle ---

  async join(meta?: { projectId: string; ownerUid: string }): Promise<void> {
    if (meta) {
      await runTransaction(child(this.root, "meta"), (cur) => cur ?? { ...meta, createdAt: Date.now() });
    }
    await set(child(this.root, `members/${this.uid}`), {
      email: this.email,
      name: this.name ?? null,
      photo: this.photo ?? null,
      at: serverTimestamp(),
    });
    const pres = child(this.root, `presence/${this.uid}`);
    await set(pres, this.presenceValue());
    void onDisconnect(pres).remove();
  }

  leave(): void {
    for (const u of this.subs) u();
    this.subs = [];
    void remove(child(this.root, `presence/${this.uid}`)).catch(() => {});
  }

  // --- catch-up snapshot + patches ---

  /** Latest full project JSON published to the room (for joiners), if any. */
  async readSnapshot(): Promise<{ rev: number; json: string } | null> {
    return new Promise((resolvep) => {
      onValue(
        child(this.root, "snapshot"),
        (snap) => {
          const v = snap.val() as { rev?: number; json?: string } | null;
          resolvep(v?.json ? { rev: v.rev ?? 0, json: v.json } : null);
        },
        { onlyOnce: true },
      );
    });
  }

  /** Publish local ops as the next rev; refresh the snapshot periodically. */
  async publish(ops: SyncOp[], snapshotJson: string): Promise<number> {
    const headRef = child(this.root, "head");
    const tx = await runTransaction(headRef, (cur: { rev?: number } | null) => ({
      rev: (cur?.rev ?? 0) + 1,
      uid: this.uid,
      at: Date.now(),
    }));
    const rev = (tx.snapshot.val() as { rev: number }).rev;
    const patch: WirePatch = { rev, uid: this.uid, opsJson: JSON.stringify(ops) };
    const pref = push(child(this.root, "patches"));
    await set(pref, patch);
    if (rev % SNAPSHOT_EVERY === 1) {
      await set(child(this.root, "snapshot"), { rev, json: snapshotJson, at: serverTimestamp() });
      // Prune: patches are transient; the snapshot carries the state forward.
      // (Old children are removed lazily by the next publisher.)
      void this.prunePatches();
    }
    return rev;
  }

  private async prunePatches(): Promise<void> {
    onValue(
      child(this.root, "patches"),
      (snap) => {
        const all: Array<[string, unknown]> = [];
        snap.forEach((c) => {
          all.push([c.key ?? "", c.val()]);
        });
        const keep = 40; // small replay window past the snapshot
        if (all.length > keep) {
          for (const [k] of all.slice(0, all.length - keep)) {
            void remove(child(this.root, `patches/${k}`)).catch(() => {});
          }
        }
      },
      { onlyOnce: true },
    );
  }

  /** Live inbound patches (includes own — caller filters by uid). */
  onPatch(cb: (p: RoomPatch) => void): void {
    const base = child(this.root, "patches");
    const q = this.lastSeenPatchKey
      ? query(base, orderByKey(), startAfter(this.lastSeenPatchKey))
      : base;
    this.subs.push(
      onChildAdded(q, (snap) => {
        if (snap.key) this.lastSeenPatchKey = snap.key;
        const wire = snap.val() as WirePatch;
        let ops: SyncOp[] = [];
        try {
          ops = wire.opsJson ? (JSON.parse(wire.opsJson) as SyncOp[]) : (wire.ops ?? []);
        } catch {
          ops = [];
        }
        cb({ rev: wire.rev, uid: wire.uid, ops });
      }),
    );
  }

  // --- presence ---

  setPresence(activeSceneId: string | null): void {
    void set(child(this.root, `presence/${this.uid}`), this.presenceValue(activeSceneId)).catch(() => {});
  }

  onPresence(cb: (entries: PresenceEntry[]) => void): void {
    this.subs.push(
      onValue(child(this.root, "presence"), (snap) => {
        const out: PresenceEntry[] = [];
        snap.forEach((c) => {
          const v = c.val() as { email?: string; name?: string | null; photo?: string | null; activeSceneId?: string | null };
          out.push({
            uid: c.key ?? "",
            email: v.email ?? "",
            name: v.name ?? undefined,
            photo: v.photo ?? undefined,
            activeSceneId: v.activeSceneId,
          });
        });
        cb(out);
      }),
    );
  }

  // --- field locks (cleared on disconnect; UI treats >30s-stale as free) ---

  lockField(path: string): void {
    const r = child(this.root, `locks/${encKey(path)}`);
    // Transactional acquire: NEVER steal a lock someone else holds — a click
    // from a second user must not evict the person already typing.
    void runTransaction(r, (cur: { uid?: string } | null) => {
      if (cur && cur.uid && cur.uid !== this.uid) return undefined; // abort
      return { uid: this.uid, email: this.name ?? this.email, at: Date.now() };
    })
      .then((tx) => {
        if (tx.committed) void onDisconnect(r).remove();
      })
      .catch(() => {});
  }

  unlockField(path: string): void {
    // Only release your OWN lock (a late blur must not clear the peer's).
    void runTransaction(r0(this.root, path), (cur: { uid?: string } | null) => {
      if (cur && cur.uid && cur.uid !== this.uid) return cur; // keep theirs
      return null;
    }).catch(() => {});
  }

  onLocks(cb: (locks: LockEntry[]) => void): void {
    this.subs.push(
      onValue(child(this.root, "locks"), (snap) => {
        const out: LockEntry[] = [];
        const now = Date.now();
        snap.forEach((c) => {
          const v = c.val() as { uid: string; email: string; at: number };
          if (now - (v.at ?? 0) < 30_000 || v.uid) {
            out.push({ path: decKey(c.key ?? ""), uid: v.uid, email: v.email });
          }
        });
        cb(out);
      }),
    );
  }

  // --- asset relay (base64 chunks; deleted after a short grace period) ---

  /** Ask the room for an asset by its local ref path (e.g. assets/job_x.png). */
  requestAsset(refPath: string): void {
    void set(child(this.root, `assetReq/${encKey(refPath)}`), {
      uid: this.uid,
      at: serverTimestamp(),
    }).catch(() => {});
  }

  /** Serve asset requests we can fulfill from the local store. */
  onAssetRequest(loader: (refPath: string) => Promise<Blob | null>): void {
    this.subs.push(
      onChildAdded(child(this.root, "assetReq"), async (snap) => {
        const key = snap.key ?? "";
        const req = snap.val() as { uid: string };
        if (!key || req.uid === this.uid) return;
        const refPath = decKey(key);
        const blob = await loader(refPath);
        if (!blob) return; // someone else may have it
        await this.publishAsset(refPath, blob).catch(() => {});
        void remove(child(this.root, `assetReq/${key}`)).catch(() => {});
      }),
    );
  }

  /** Push an asset's bytes to the room (live generation or catch-up). */
  async publishAsset(refPath: string, blob: Blob): Promise<void> {
    const key = encKey(refPath);
    const chunks = await blobToB64(blob);
    const base = child(this.root, `assets/${key}`);
    for (let i = 0; i < chunks.length; i++) {
      await set(child(base, `chunks/${String(i).padStart(4, "0")}`), chunks[i]);
    }
    await set(child(base, "meta"), {
      type: blob.type || "application/octet-stream",
      chunks: chunks.length,
      from: this.uid,
      at: serverTimestamp(),
    });
    // Chunks are transient: give listeners a grace period, then delete.
    setTimeout(() => void remove(base).catch(() => {}), 120_000);
  }

  /** Inbound assets (meta written last = complete). */
  onAsset(cb: (refPath: string, blob: Blob) => void): void {
    this.subs.push(
      onChildAdded(child(this.root, "assets"), (snap) => {
        const key = snap.key ?? "";
        // meta may not be there yet on first child event — watch until complete.
        const metaRef = child(this.root, `assets/${key}/meta`);
        const un = onValue(metaRef, (m) => {
          const meta = m.val() as { type: string; chunks: number; from: string } | null;
          if (!meta) return;
          un();
          if (meta.from === this.uid) return; // own upload
          onValue(
            child(this.root, `assets/${key}/chunks`),
            (cs) => {
              const chunks: string[] = [];
              cs.forEach((c) => {
                chunks.push(c.val() as string);
              });
              if (chunks.length === meta.chunks) {
                cb(decKey(key), b64ToBlob(chunks, meta.type));
              }
            },
            { onlyOnce: true },
          );
        });
      }),
    );
  }
}
