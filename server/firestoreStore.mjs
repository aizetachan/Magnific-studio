// Firestore-backed key/value store for the Director's small server state
// (encrypted Magnific OAuth sessions + msid→uid bindings). Zero-dependency:
// REST + Application Default Credentials.
//
// Token sources, in order:
//   1. Cloud Run / GCE metadata server (production — no keys to manage).
//   2. GOOGLE_APPLICATION_CREDENTIALS service-account JSON (local testing).
//
// Values are opaque strings (the caller encrypts), one Firestore doc per key:
//   directorState/<docId> { v: <string>, at: <ms> }

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
const COLLECTION = "directorState";

let cached = { token: null, expiresAt: 0 };

async function metadataToken() {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(2000) },
  );
  if (!res.ok) throw new Error(`metadata ${res.status}`);
  const d = await res.json();
  return { token: d.access_token, ttlSec: d.expires_in ?? 300 };
}

async function serviceAccountToken() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("no GOOGLE_APPLICATION_CREDENTIALS");
  const sa = JSON.parse(readFileSync(path, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(sa.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const d = await res.json();
  return { token: d.access_token, ttlSec: d.expires_in ?? 3600 };
}

async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const got = await (process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? serviceAccountToken()
    : metadataToken());
  cached = { token: got.token, expiresAt: Date.now() + got.ttlSec * 1000 };
  return cached.token;
}

/** Whether the Firestore store is worth attempting in this environment. */
export function firestoreStoreAvailable() {
  return !!PROJECT_ID && (!!process.env.K_SERVICE || !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

const docUrl = (docId) =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(docId)}`;

/** Write an opaque string value (upsert). */
export async function fsPut(docId, value) {
  const token = await accessToken();
  const res = await fetch(`${docUrl(docId)}?updateMask.fieldPaths=v&updateMask.fieldPaths=at`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      fields: { v: { stringValue: value }, at: { integerValue: String(Date.now()) } },
    }),
  });
  if (!res.ok) throw new Error(`firestore put ${res.status}`);
}

/** Read an opaque string value, or null. */
export async function fsGet(docId) {
  const token = await accessToken();
  const res = await fetch(docUrl(docId), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get ${res.status}`);
  const d = await res.json();
  return d?.fields?.v?.stringValue ?? null;
}

/** Delete a value (missing docs are fine). */
export async function fsDelete(docId) {
  const token = await accessToken();
  const res = await fetch(docUrl(docId), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`firestore delete ${res.status}`);
}
