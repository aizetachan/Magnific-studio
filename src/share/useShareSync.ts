/**
 * useShareSync — binds the current project to its RTDB room when shared.
 *
 * Outbound: on every project change (debounced), diff the SYNCED sections
 * against the last synced state (dehydrated: stable local: refs, no blob:)
 * and publish entity ops + a rolling snapshot. New local assets are pushed to
 * the room so every participant saves a copy in their own folder.
 *
 * Inbound: apply peers' ops onto the live project, hydrate any refs whose
 * bytes we already have, and request missing ones from the room.
 */

import { useEffect, useRef } from "react";
import type { Project } from "@/types/project";
import {
  dehydrateAssetRefs,
  hydrateAssetRefs,
  loadLocalBlob,
  preloadLocalAssets,
  registerIncomingAsset,
} from "@/state/assets";
import { me, meProfile, shareEnabled } from "./db";
import { applyOps, computeOps, normalizeProject } from "./diff";
import { ShareRoom, type PresenceEntry } from "./room";
import { bindLocks, setLocks, unbindLocks } from "./locks";

// Presence is exposed app-wide through a tiny observable (avatars in Topbar).
let presence: PresenceEntry[] = [];
const presListeners = new Set<() => void>();
export function getPresence(): PresenceEntry[] {
  return presence;
}
export function subscribePresence(fn: () => void): () => void {
  presListeners.add(fn);
  return () => presListeners.delete(fn);
}
function setPresence(p: PresenceEntry[]) {
  presence = p;
  for (const fn of presListeners) fn();
}

/** Shared sections only, dehydrated — the wire format for ops/snapshots. */
function sharedView(p: Project): Project {
  const clone = structuredClone(p) as Project;
  dehydrateAssetRefs(clone);
  clone.settings = undefined as unknown as Project["settings"];
  clone.consumption = undefined as unknown as Project["consumption"];
  return clone;
}

/** Last room revision this device has incorporated (per room, durable). */
const revKey = (roomId: string) => `magnific-studio:room-rev:${roomId}`;
function getMyRev(roomId: string): number {
  const v = Number(localStorage.getItem(revKey(roomId)) ?? "0");
  return Number.isFinite(v) ? v : 0;
}
function setMyRev(roomId: string, rev: number): void {
  if (rev > getMyRev(roomId)) localStorage.setItem(revKey(roomId), String(rev));
}

/** Collect every local: ref present in a value. */
function localRefsIn(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.startsWith("local:")) out.add(node);
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(v);
  return [...out];
}

export function useShareSync(
  project: Project,
  setProject: (updater: (prev: Project) => Project) => void,
): void {
  const roomRef = useRef<ShareRoom | null>(null);
  const lastSynced = useRef<Project | null>(null);
  const publishedAssets = useRef(new Set<string>());
  const projectRef = useRef(project);
  projectRef.current = project;

  const share = project.share;
  const roomId = share?.roomId;

  // Room lifecycle — per (roomId, signed-in user).
  useEffect(() => {
    if (!roomId || !shareEnabled) return;
    const user = me();
    if (!user) return;
    const prof = meProfile();
    const room = new ShareRoom(roomId, user.uid, user.email, prof?.name, prof?.photo);
    roomRef.current = room;
    lastSynced.current = null;

    const applyRemoteJson = async (json: string) => {
      const incoming = JSON.parse(json) as Project;
      await preloadLocalAssets(incoming);
      setProject((prev) => {
        const next = structuredClone(incoming) as Project;
        next.settings = prev.settings; // never synced
        next.consumption = prev.consumption;
        next.share = prev.share;
        normalizeProject(next);
        hydrateAssetRefs(next);
        lastSynced.current = sharedView(next);
        return next;
      });
      for (const ref of localRefsIn(incoming)) {
        if (!(await loadLocalBlob(ref))) room.requestAsset(ref);
      }
    };

    void (async () => {
      try {
      await room.join({ projectId: projectRef.current.id, ownerUid: share?.ownerUid ?? user.uid });

      // Catch-up by REVISION: adopt the room snapshot ONLY if it's ahead of
      // what this device has already incorporated. Never revert local content
      // to an older rolling snapshot (a reload must not lose work).
      const snap = await room.readSnapshot();
      const myRev = getMyRev(roomId);
      if (snap && snap.rev > myRev) {
        await applyRemoteJson(snap.json);
        setMyRev(roomId, snap.rev);
      } else {
        lastSynced.current = sharedView(projectRef.current);
        // We kept local state: if it differs from the room snapshot, publish
        // the diff so the room (and everyone in it) converges to OUR version
        // instead of resurrecting the stale one (covers offline edits too).
        if (snap) {
          try {
            const base = JSON.parse(snap.json) as Project;
            const ops = computeOps(base, sharedView(projectRef.current));
            if (ops.length > 0) {
              const rev = await room.publish(ops, JSON.stringify(sharedView(projectRef.current)));
              setMyRev(roomId, rev);
            }
          } catch (e) {
            console.warn("[share] catch-up diff failed:", e);
          }
        }
      }

      room.onPatch((p) => {
        setMyRev(roomId, p.rev);
        if (p.uid === user.uid) return;
        void (async () => {
          for (const op of p.ops) {
            for (const ref of localRefsIn(op.value)) {
              if (!(await loadLocalBlob(ref))) room.requestAsset(ref);
            }
          }
          await preloadLocalAssets({ ops: p.ops });
          setProject((prev) => {
            const next = structuredClone(prev) as Project;
            applyOps(next, p.ops);
            normalizeProject(next);
            hydrateAssetRefs(next);
            lastSynced.current = sharedView(next);
            return next;
          });
        })();
      });

      room.onPresence(setPresence);
      room.onLocks(setLocks);
      bindLocks(
        user.uid,
        (path) => room.lockField(path),
        (path) => room.unlockField(path),
      );

      // Serve peers' asset requests from our local store; adopt inbound bytes.
      room.onAssetRequest((refPath) => loadLocalBlob(refPath));
      room.onAsset((refPath, blob) => {
        void registerIncomingAsset(refPath, blob).then(() => {
          setProject((prev) => {
            const next = structuredClone(prev) as Project;
            // Re-resolve any still-unhydrated refs now that the bytes exist.
            return hydrateAssetRefs(next) ? next : prev;
          });
        });
      });
      } catch (e) {
        console.error("[share] room join failed:", e);
      }
    })();

    return () => {
      room.leave();
      roomRef.current = null;
      unbindLocks();
      setPresence([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Outbound publish — debounced on project changes.
  useEffect(() => {
    const room = roomRef.current;
    if (!room || !lastSynced.current) return;
    const t = setTimeout(() => {
      void (async () => {
        const current = sharedView(project);
        const prev = lastSynced.current;
        if (!prev) return;
        const ops = computeOps(prev, current);
        if (ops.length === 0) return;
        lastSynced.current = current;
        const rev = await room.publish(ops, JSON.stringify(current)).catch(() => 0);
        if (rev) setMyRev(room.roomId, rev);
        // Push any NEW local assets referenced by the ops to the room so
        // peers store their own copy (one generation → N local folders).
        for (const op of ops) {
          for (const ref of localRefsIn(op.value)) {
            if (publishedAssets.current.has(ref)) continue;
            publishedAssets.current.add(ref);
            const blob = await loadLocalBlob(ref);
            if (blob && blob.size < 100 * 1024 * 1024) {
              await room.publishAsset(ref, blob).catch(() => {});
            }
          }
        }
      })();
    }, 150); // near-realtime: words appear as they're typed, not in bursts
    return () => clearTimeout(t);
  }, [project]);
}
