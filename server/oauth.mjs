// OAuth 2.0 (Authorization Code + PKCE) for the Magnific MCP server, following
// the MCP authorization spec: discover metadata, dynamic client registration
// (DCR), then per-user authorize/callback/refresh. Everything is discovery- or
// env-driven so it works against Magnific (or any spec-compliant MCP server)
// without hardcoded endpoints.
//
// Each user connects their OWN account; tokens are stored per session (in
// memory for the MVP — swap for a real store in production).

import { createHash, randomBytes } from "node:crypto";

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState() {
  return b64url(randomBytes(16));
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/**
 * Resolve the authorization server endpoints for an MCP resource URL.
 * 1) protected-resource metadata -> authorization_servers[0]
 * 2) authorization-server metadata -> authorize/token/registration endpoints
 * Falls back to env overrides when discovery isn't available.
 */
export async function discover(mcpUrl, env = {}) {
  // Env overrides win (useful when discovery endpoints aren't exposed).
  if (env.AUTH_URL && env.TOKEN_URL) {
    return {
      authorization_endpoint: env.AUTH_URL,
      token_endpoint: env.TOKEN_URL,
      registration_endpoint: env.REGISTRATION_URL,
      scopes_supported: env.SCOPE ? env.SCOPE.split(" ") : undefined,
    };
  }

  const origin = new URL(mcpUrl).origin;
  let asUrl = origin;
  try {
    const pr = await getJson(`${origin}/.well-known/oauth-protected-resource`);
    if (Array.isArray(pr.authorization_servers) && pr.authorization_servers[0]) {
      asUrl = pr.authorization_servers[0];
    }
  } catch {
    // No protected-resource doc — assume the resource origin is the AS.
  }

  const asOrigin = new URL(asUrl).origin;
  let meta;
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    try {
      meta = await getJson(`${asOrigin}${path}`);
      break;
    } catch {
      /* try next */
    }
  }
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
    throw new Error("could not discover OAuth endpoints (set AUTH_URL/TOKEN_URL)");
  }
  return {
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    registration_endpoint: meta.registration_endpoint,
    scopes_supported: meta.scopes_supported,
  };
}

/** Dynamic Client Registration (RFC 7591). Cached by the caller. */
export async function registerClient(registrationEndpoint, redirectUri) {
  const reg = await getJson(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Magnific Studio",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  return { client_id: reg.client_id, client_secret: reg.client_secret };
}

export function authorizeUrl({
  authorization_endpoint,
  client_id,
  redirectUri,
  state,
  challenge,
  scope,
  resource,
}) {
  const u = new URL(authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (scope) u.searchParams.set("scope", scope);
  if (resource) u.searchParams.set("resource", resource); // RFC 8707
  return u.toString();
}

async function tokenRequest(tokenEndpoint, params, clientSecret) {
  const body = new URLSearchParams(params);
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (clientSecret) {
    const basic = Buffer.from(`${params.client_id}:${clientSecret}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  const res = await fetch(tokenEndpoint, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export function exchangeCode({
  token_endpoint,
  client_id,
  client_secret,
  code,
  verifier,
  redirectUri,
  resource,
}) {
  return tokenRequest(
    token_endpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id,
      code_verifier: verifier,
      ...(resource ? { resource } : {}),
    },
    client_secret,
  );
}

export function refreshToken({
  token_endpoint,
  client_id,
  client_secret,
  refresh_token,
  resource,
}) {
  return tokenRequest(
    token_endpoint,
    {
      grant_type: "refresh_token",
      refresh_token,
      client_id,
      ...(resource ? { resource } : {}),
    },
    client_secret,
  );
}
