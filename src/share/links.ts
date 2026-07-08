/**
 * Share links + join requests ("knocks") — Firestore metadata only.
 *
 * A link is a capability token resolving to a project. Two modes:
 *  - "approval" (default): the link doc does NOT carry the room key; opening
 *    it creates a knock the owner must approve. The room key is written into
 *    the knock only on approval — so the link alone never grants access.
 *  - "open": anyone with the link (signed in with Google) joins directly;
 *    the link doc carries the room key. Regenerating the link revokes it.
 *
 * Optional expiry (`exp` ms epoch, null = never).
 */

import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  collection,
  onSnapshot as onQuerySnapshot,
  query,
  where,
} from "firebase/firestore";
import { firestore, me } from "./db";

export type LinkMode = "approval" | "open";

export interface ShareLink {
  token: string;
  projectId: string;
  projectName: string;
  ownerUid: string;
  ownerName: string;
  mode: LinkMode;
  /** ms epoch; null = never expires. */
  exp: number | null;
  /** Present only when mode === "open". */
  roomId?: string;
}

export interface Knock {
  id: string;
  token: string;
  projectId: string;
  projectName: string;
  ownerUid: string;
  uid: string;
  email: string;
  name: string;
  photo?: string;
  status: "pending" | "approved" | "rejected";
  /** Written by the owner on approval. */
  roomId?: string;
  at: number;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function linkUrl(token: string): string {
  return `${window.location.origin}/home?join=${token}`;
}

/** Create (or replace) the share link for a project. Returns the new token. */
export async function createLink(input: {
  projectId: string;
  projectName: string;
  roomId: string;
  mode: LinkMode;
  expDays: number | null;
  replaceToken?: string | null;
}): Promise<string> {
  const user = me();
  if (!user) throw new Error("Sign in to share");
  const token = randomToken();
  const payload: Record<string, unknown> = {
    projectId: input.projectId,
    projectName: input.projectName,
    ownerUid: user.uid,
    ownerName: user.email,
    mode: input.mode,
    exp: input.expDays ? Date.now() + input.expDays * 24 * 60 * 60 * 1000 : null,
    at: Date.now(),
  };
  // SECURITY: the room key travels in the link doc only in "open" mode.
  if (input.mode === "open") payload.roomId = input.roomId;
  await setDoc(doc(firestore(), "links", token), payload);
  if (input.replaceToken) {
    await deleteDoc(doc(firestore(), "links", input.replaceToken)).catch(() => {});
  }
  return token;
}

export async function resolveLink(token: string): Promise<ShareLink | null> {
  const snap = await getDoc(doc(firestore(), "links", token));
  if (!snap.exists()) return null;
  return { token, ...(snap.data() as Omit<ShareLink, "token">) };
}

// --- Knocks ---

const knockId = (token: string, uid: string) => `${token}_${uid}`;

/** Ask to enter (approval-mode links). Idempotent per (link, user). */
export async function createKnock(link: ShareLink): Promise<string> {
  const user = me();
  if (!user) throw new Error("Sign in first");
  const id = knockId(link.token, user.uid);
  const ref = doc(firestore(), "knocks", id);
  const existing = await getDoc(ref);
  if (existing.exists()) return id; // pending/approved/rejected — caller reads it
  const { getAuth } = await import("firebase/auth");
  const u = getAuth().currentUser;
  await setDoc(ref, {
    token: link.token,
    projectId: link.projectId,
    projectName: link.projectName,
    ownerUid: link.ownerUid,
    uid: user.uid,
    email: user.email,
    name: u?.displayName ?? user.email,
    photo: u?.photoURL ?? null,
    status: "pending",
    at: Date.now(),
  });
  return id;
}

/** Live view of one knock (the waiting screen listens to its own request). */
export function watchKnock(id: string, cb: (k: Knock | null) => void): () => void {
  return onSnapshot(doc(firestore(), "knocks", id), (snap) => {
    cb(snap.exists() ? ({ id, ...(snap.data() as Omit<Knock, "id">) } as Knock) : null);
  });
}

/** Owner: live list of MY pending join requests (all projects). */
export function watchMyPendingKnocks(cb: (ks: Knock[]) => void): () => void {
  const user = me();
  if (!user) return () => {};
  const q = query(
    collection(firestore(), "knocks"),
    where("ownerUid", "==", user.uid),
    where("status", "==", "pending"),
  );
  return onQuerySnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Knock, "id">) }) as Knock));
  });
}

/** Owner approves: hands the room key to the requester. */
export async function approveKnock(k: Knock, roomId: string): Promise<void> {
  await updateDoc(doc(firestore(), "knocks", k.id), { status: "approved", roomId });
}

export async function rejectKnock(k: Knock): Promise<void> {
  await updateDoc(doc(firestore(), "knocks", k.id), { status: "rejected" });
}
