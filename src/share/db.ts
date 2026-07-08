/**
 * Firebase data-plane handles for the Share feature (Fase 0.5).
 *
 * Realtime Database = the ephemeral collaboration channel (patches, presence,
 * field locks, asset chunks). Firestore = durable metadata only (invitations).
 * User CONTENT still lives on each participant's machine — the room relays it,
 * it never stores it durably (patches are pruned, snapshot is transient state).
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import { getFirestore, type Firestore } from "firebase/firestore";

const env = import.meta.env as Record<string, string | undefined>;

/** Share needs auth + RTDB configured; without it the UI hides itself. */
export const shareEnabled = !!(
  env.VITE_FIREBASE_API_KEY &&
  env.VITE_FIREBASE_PROJECT_ID &&
  env.VITE_FIREBASE_DATABASE_URL
);

function app(): FirebaseApp {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
    databaseURL: env.VITE_FIREBASE_DATABASE_URL ?? "",
  });
}

export function rtdb(): Database {
  return getDatabase(app());
}

export function firestore(): Firestore {
  return getFirestore(app());
}

/** Current signed-in user (uid/email) or null. Never throws (dev mode has
 * no Firebase config, and getAuth would explode with auth/invalid-api-key). */
export function me(): { uid: string; email: string } | null {
  if (!shareEnabled) return null;
  try {
    const u = getAuth(app()).currentUser;
    return u ? { uid: u.uid, email: u.email ?? "" } : null;
  } catch {
    return null;
  }
}

/** Full profile for presence (display name + Google avatar). */
export function meProfile(): { uid: string; email: string; name?: string; photo?: string } | null {
  if (!shareEnabled) return null;
  let u;
  try {
    u = getAuth(app()).currentUser;
  } catch {
    return null;
  }
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email ?? "",
    name: u.displayName ?? undefined,
    photo: u.photoURL ?? undefined,
  };
}
