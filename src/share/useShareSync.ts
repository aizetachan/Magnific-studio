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
import { me, shareEnabled } from "./db";
import { applyOps, computeOps } from "./diff";
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
    const user = me();
    if (!roomId || !shareEnabled || !user) return;
    const room = new ShareRoom(roomId, user.uid, user.email);
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
        hydrateAssetRefs(next);
        lastSynced.current = sharedView(next);
        return next;
      });
      for (const ref of localRefsIn(incoming)) {
        if (!(await loadLocalBlob(ref))) room.requestAsset(ref);
      }
    };

    void (async () => {
      await room.join({ projectId: projectRef.current.id, ownerUid: share?.ownerUid ?? user.uid });

      // Catch-up: adopt the room snapshot when it's ahead of what we have.
      const snap = await room.readSnapshot();
      const localEmpty = projectRef.current.shots.length === 0 && projectRef.current.scenes.length === 0;
      if (snap && (localEmpty || share?.ownerUid !== user.uid)) {
        await applyRemoteJson(snap.json);
      } else {
        lastSynced.current = sharedView(projectRef.current);
      }

      room.onPatch((p) => {
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
        await room.publish(ops, JSON.stringify(current)).catch(() => {});
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
    }, 600);
    return () => clearTimeout(t);
  }, [project]);
}
