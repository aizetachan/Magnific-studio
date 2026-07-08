// Firebase ID token verification — zero-dependency (node:crypto + fetch).
//
// Verifies the RS256 signature against Google's published x509 certs for
// securetoken@system.gserviceaccount.com and checks the standard claims
// (aud = project id, iss = securetoken issuer, exp/iat, non-empty sub).
// Docs: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

import { X509Certificate, createVerify } from "node:crypto";

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache = { certs: null, expiresAt: 0 };

async function googleCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const certs = await res.json();
  // Honor Google's cache header so rotation is picked up.
  const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
  const ttl = m ? Number(m[1]) * 1000 : 60 * 60 * 1000;
  certCache = { certs, expiresAt: Date.now() + ttl };
  return certs;
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Verify a Firebase ID token for the given project. Returns { uid, email }.
 * Throws on any invalid token.
 */
export async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("token malformado");
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("alg/kid inválido");

  const certs = await googleCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error("kid desconocido");
  const key = new X509Certificate(pem).publicKey;

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(key, Buffer.from(parts[2], "base64url"))) {
    throw new Error("firma inválida");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("aud inválido");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("iss inválido");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("token caducado");
  if (typeof payload.iat !== "number" || payload.iat > now + 300) throw new Error("iat inválido");
  if (!payload.sub) throw new Error("sub vacío");

  return { uid: String(payload.sub), email: payload.email };
}
