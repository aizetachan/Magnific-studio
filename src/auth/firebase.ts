/**
 * Firebase Auth (Google login) — optional by configuration.
 *
 * When the VITE_FIREBASE_* vars are present, the app requires a Google login
 * and BINDS the session to the backend: after sign-in (and on every token
 * refresh) the ID token is POSTed to /api/director/auth/firebase, where the
 * server verifies it and associates the existing `msid` cookie with the uid.
 * All other backend calls keep using the cookie — no per-request headers.
 *
 * Without the vars (local dev / fresh clone) the app runs exactly as before:
 * no login, anonymous per-browser session.
 */

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { config } from "@/config";

const env = import.meta.env as Record<string, string | undefined>;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

/** Whether Google login is configured (prod). False = open dev mode. */
export const authEnabled = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
function ensureApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

/** Send the ID token to the backend so the msid session is bound to the uid. */
async function bindSession(user: User | null): Promise<void> {
  try {
    const idToken = user ? await user.getIdToken() : null;
    await fetch(`${config.directorBase}/auth/firebase`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    /* backend offline — retried on the next token refresh */
  }
}

/** Subscribe to auth state; keeps the backend session binding fresh. */
export function watchAuth(cb: (user: User | null) => void): () => void {
  if (!authEnabled) {
    cb(null);
    return () => {};
  }
  const auth = getAuth(ensureApp());
  return onIdTokenChanged(auth, (user) => {
    void bindSession(user);
    cb(user);
  });
}

export async function loginWithGoogle(): Promise<void> {
  const auth = getAuth(ensureApp());
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function logout(): Promise<void> {
  const auth = getAuth(ensureApp());
  await bindSession(null);
  await signOut(auth);
}
