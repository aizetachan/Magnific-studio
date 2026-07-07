/**
 * Field locks — tiny observable store + hook.
 *
 * While a user edits a field, peers see it disabled with the editor's name
 * ("Figma-style" pessimistic locking at field granularity). The sync engine
 * (useShareSync) binds the store to the active room; without a room the hook
 * is inert and fields behave normally.
 */

import { useSyncExternalStore } from "react";
import type { LockEntry } from "./room";

let locks: LockEntry[] = [];
let myUid = "";
let acquireFn: ((path: string) => void) | null = null;
let releaseFn: ((path: string) => void) | null = null;
const listeners = new Set<() => void>();

export function bindLocks(
  uid: string,
  acquire: (path: string) => void,
  release: (path: string) => void,
): void {
  myUid = uid;
  acquireFn = acquire;
  releaseFn = release;
}

export function unbindLocks(): void {
  myUid = "";
  acquireFn = releaseFn = null;
  setLocks([]);
}

export function setLocks(next: LockEntry[]): void {
  locks = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Lock-aware props for an editable field. Spread the handlers onto the input
 * and disable it when `lockedBy` is set:
 *
 *   const l = useFieldLock(`shot:${shot.id}:prompt`);
 *   <textarea disabled={!!l.lockedBy} title={l.lockedBy ?? ""}
 *             onFocus={l.onFocus} onBlur={l.onBlur} ... />
 */
export function useFieldLock(path: string): {
  lockedBy: string | null;
  onFocus: () => void;
  onBlur: () => void;
} {
  const snapshot = useSyncExternalStore(subscribe, () => locks);
  const other = snapshot.find((l) => l.path === path && l.uid !== myUid);
  return {
    lockedBy: other ? other.email || "otro usuario" : null,
    onFocus: () => acquireFn?.(path),
    onBlur: () => releaseFn?.(path),
  };
}
