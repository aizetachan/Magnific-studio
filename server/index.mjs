// Magnific Studio — Director backend (MCP orchestration + per-user OAuth).
//
// Claude (the BRAIN) runs the Magnific MCP tools via Anthropic's MCP connector,
// server-side, so the OAuth/MCP session and keys stay off the browser. Each
// user connects their OWN Magnific account through a standard OAuth 2.0 flow
// (discovery + dynamic client registration + PKCE); tokens are stored per
// session. Graceful by design: with nothing configured it returns a mock.
//
// Zero runtime deps: Node's http + global fetch + node:crypto.
//
// Env:
//   PORT (8787) · APP_ORIGIN (http://localhost:5173) · ALLOW_ORIGIN (APP_ORIGIN)
//   ANTHROPIC_API_KEY · ANTHROPIC_MODEL (claude-opus-4-8)
//   MAGNIFIC_MCP_URL  (e.g. https://mcp.magnific.com — the MCP resource)
//   MAGNIFIC_MCP_TOKEN (optional static token; per-user OAuth is preferred)
//   MAGNIFIC_OAUTH_CLIENT_ID / _SECRET (optional; else dynamic registration)
//   MAGNIFIC_OAUTH_AUTH_URL / _TOKEN_URL / _REGISTRATION_URL (optional override)
//   MAGNIFIC_OAUTH_SCOPE (optional)

import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, extname, basename, resolve } from "node:path";
import {
  authorizeUrl,
  discover,
  exchangeCode,
  pkce,
  randomState,
  refreshToken,
  registerClient,
} from "./oauth.mjs";
import {
  accountBalance,
  callTool,
  createLibraryAsset,
  uploadCreationBytes,
  creationAssetUrl,
  creationAssetUrlWait,
  creationInfo,
  extractIdentifiers,
  firstVoiceId,
  listLibrary,
  listVoices,
  readCreation,
} from "./mcpClient.mjs";
import { cleanupDir, hasFfmpeg, renderTimeline } from "./render.mjs";
import { verifyFirebaseIdToken } from "./firebaseAuth.mjs";
import { firestoreStoreAvailable, fsDelete, fsGet, fsPut } from "./firestoreStore.mjs";
import {
  buildGenerationCall,
  expectedSecFor,
  listModels,
  modelSupportsImageRef,
  resolveSlug,
} from "./generate.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:5173";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? APP_ORIGIN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
// Defaults to Magnific's hosted MCP so a fresh clone runs with zero config; each
// user still connects their own account via OAuth in Ajustes.
const MCP_URL = process.env.MAGNIFIC_MCP_URL ?? "https://mcp.magnific.com";
const MCP_STATIC_TOKEN = process.env.MAGNIFIC_MCP_TOKEN ?? "";
// Local-per-machine asset store. Generated files are downloaded here so they
// outlive Magnific's expiring signed URLs; served back at /api/director/files/.
const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? "./storage");
// Built SPA (served same-origin in production; absent in dev, where Vite runs).
const DIST_DIR = resolve(process.env.DIST_DIR ?? "./dist");
const REDIRECT_URI = `${APP_ORIGIN}/api/director/auth/callback`;
const OAUTH_ENV = {
  AUTH_URL: process.env.MAGNIFIC_OAUTH_AUTH_URL,
  TOKEN_URL: process.env.MAGNIFIC_OAUTH_TOKEN_URL,
  REGISTRATION_URL: process.env.MAGNIFIC_OAUTH_REGISTRATION_URL,
  SCOPE: process.env.MAGNIFIC_OAUTH_SCOPE,
};

// --- In-memory stores (swap for a real store in production) ---
const sessions = new Map(); // sid -> { tokens: {access_token, refresh_token, expires_at} }
const pending = new Map(); // state -> { sid, verifier }
const jobs = new Map(); // jobId -> { sid, kind, identifiers, status, resultUrl?, credits?, error?, expectedSec, createdAt, mock? }
let clientReg = null; // { client_id, client_secret } cached for this process
let discovered = null; // discovered endpoints, cached

// Persist OAuth sessions to disk so a server restart does NOT drop the user's
// Magnific connection. With SESSION_ENC_KEY set, tokens are encrypted at rest
// (AES-256-GCM); without it they are plaintext (dev) and a warning is logged.
const SESSIONS_FILE = join(STORAGE_DIR, "sessions.json");
const SESSION_ENC_KEY = process.env.SESSION_ENC_KEY ?? "";
if (!SESSION_ENC_KEY && process.env.NODE_ENV === "production") {
  console.warn("[director] SESSION_ENC_KEY no está definido: los tokens Magnific se guardan SIN cifrar");
}
const encKey = () => createHash("sha256").update(SESSION_ENC_KEY).digest();
function encryptJson(obj) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return JSON.stringify({
    enc: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}
function decryptJson(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed?.enc) return parsed; // legacy plaintext — migrated on next persist
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(out.toString("utf8"));
}
function loadSessions() {
  try {
    const obj = decryptJson(readFileSync(SESSIONS_FILE, "utf8"));
    for (const [sid, v] of Object.entries(obj)) sessions.set(sid, v);
    console.log(`[director] loaded ${sessions.size} session(s) from disk`);
  } catch {
    /* no sessions file yet, or wrong SESSION_ENC_KEY */
  }
}
function persistSessions() {
  const obj = Object.fromEntries(sessions);
  const payload = SESSION_ENC_KEY ? encryptJson(obj) : JSON.stringify(obj);
  try {
    mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(SESSIONS_FILE, payload);
  } catch {
    /* best effort */
  }
  // Durable copy in Firestore (Cloud Run's disk is ephemeral). Encrypted blob.
  if (firestoreStoreAvailable()) {
    void fsPut("sessions", payload).catch((e) =>
      console.warn("[director] firestore sessions persist failed:", e?.message ?? e),
    );
  }
}

// On-demand cross-instance sync: when a session/user lookup misses in memory,
// pull the latest snapshot from Firestore (throttled). Only fills gaps — a
// fresher local token is never overwritten by an older snapshot.
let lastSessRefresh = 0;
async function refreshSharedState() {
  if (!firestoreStoreAvailable()) return;
  const now = Date.now();
  if (now - lastSessRefresh < 10_000) return;
  lastSessRefresh = now;
  try {
    const [rawSessions, rawUsers] = await Promise.all([
      fsGet("sessions").catch(() => null),
      fsGet("users").catch(() => null),
    ]);
    if (rawSessions) {
      const obj = decryptJson(rawSessions);
      for (const [k, v] of Object.entries(obj)) if (!sessions.has(k)) sessions.set(k, v);
    }
    if (rawUsers) {
      for (const [k, v] of Object.entries(JSON.parse(rawUsers))) {
        if (!userBySid.has(k)) userBySid.set(k, v);
      }
    }
  } catch {
    /* best effort */
  }
}

/** keyOf with a cross-instance fallback when the uid binding isn't local. */
async function resolveKey(sid) {
  if (sid && !userBySid.has(sid)) await refreshSharedState();
  return keyOf(sid);
}

/** Restore server state from Firestore when the local disk came up empty. */
async function restoreFromFirestore() {
  if (!firestoreStoreAvailable()) return;
  try {
    if (sessions.size === 0) {
      const raw = await fsGet("sessions");
      if (raw) {
        const obj = decryptJson(raw);
        for (const [k, v] of Object.entries(obj)) sessions.set(k, v);
        console.log(`[director] restored ${sessions.size} session(s) from Firestore`);
      }
    }
    if (userBySid.size === 0) {
      const raw = await fsGet("users");
      if (raw) {
        for (const [k, v] of Object.entries(JSON.parse(raw))) userBySid.set(k, v);
        console.log(`[director] restored ${userBySid.size} user binding(s) from Firestore`);
      }
    }
  } catch (e) {
    console.warn("[director] firestore restore failed:", e?.message ?? e);
  }
}

// Cheap per-user rate limiting on the expensive routes (in-memory buckets).
const rateBuckets = new Map(); // `${key}|${scope}` -> { count, resetAt }
function rateLimited(key, scope, max, windowMs) {
  const k = `${key ?? "anon"}|${scope}`;
  const now = Date.now();
  let b = rateBuckets.get(k);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(k, b);
  }
  b.count++;
  return b.count > max;
}

// Persist generation jobs so a backend restart keeps in-flight work and the
// sweeper can finish it (survives close/reload + server restart).
const JOBS_FILE = join(STORAGE_DIR, "jobs.json");
function loadJobs() {
  try {
    const obj = JSON.parse(readFileSync(JOBS_FILE, "utf8"));
    for (const [id, v] of Object.entries(obj)) jobs.set(id, v);
    console.log(`[director] loaded ${jobs.size} job(s) from disk`);
  } catch {
    /* no jobs file yet */
  }
}
function persistJobs() {
  try {
    mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(JOBS_FILE, JSON.stringify(Object.fromEntries(jobs)));
  } catch {
    /* best effort */
  }
}
// The client registration is reusable across restarts too (DCR is one-time).
const CLIENT_FILE = join(STORAGE_DIR, "client.json");
function loadClientReg() {
  try {
    clientReg = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
  } catch {
    /* none yet */
  }
}
function persistClientReg() {
  try {
    mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(CLIENT_FILE, JSON.stringify(clientReg));
  } catch {
    /* best effort */
  }
}

// --- HTTP helpers ---
function cors(res) {
  res.setHeader("access-control-allow-origin", ALLOW_ORIGIN);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
function json(res, status, body, extra = {}) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}
function redirect(res, location, extra = {}) {
  cors(res);
  res.writeHead(302, { location, ...extra });
  res.end();
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function getCookie(req, name) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
// ⚠️ Firebase Hosting strips every cookie EXCEPT one literally named
// "__session" before forwarding to Cloud Run — any other name means the
// server never sees the session and every request looks like a new user.
const SESSION_COOKIE = "__session";
function sidOf(req) {
  return getCookie(req, SESSION_COOKIE) ?? getCookie(req, "msid"); // msid = legacy direct access
}
function sidCookie(sid) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`;
}
function ensureSid(req) {
  return sidOf(req) ?? randomBytes(16).toString("hex");
}

// --- Identity (Firebase Google login, optional) ---
//
// When FIREBASE_PROJECT_ID is set, the SPA posts its Firebase ID token to
// /auth/firebase and we bind the anonymous msid cookie to the verified uid.
// From then on every per-user resource (Magnific OAuth session, jobs, render
// workspace) is keyed by `uid:<uid>` instead of the device cookie — the same
// user gets their stuff from any browser. Without Firebase config the key is
// simply the cookie (dev mode, same behavior as before).
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "";
const userBySid = new Map(); // sid -> { uid, email }
const USERS_FILE = join(STORAGE_DIR, "users.json");
function loadUsers() {
  try {
    const obj = JSON.parse(readFileSync(USERS_FILE, "utf8"));
    for (const [sid, v] of Object.entries(obj)) userBySid.set(sid, v);
  } catch {
    /* no users file yet */
  }
}
function persistUsers() {
  const payload = JSON.stringify(Object.fromEntries(userBySid));
  try {
    mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(USERS_FILE, payload);
  } catch {
    /* best effort */
  }
  if (firestoreStoreAvailable()) {
    void fsPut("users", payload).catch(() => {});
  }
}
/** Session key: the verified uid when logged in, else the device cookie. */
function keyOf(sid) {
  if (!sid) return sid;
  const u = userBySid.get(sid);
  return u ? `uid:${u.uid}` : sid;
}

// --- OAuth orchestration ---
async function ensureDiscovery() {
  if (!discovered) discovered = await discover(MCP_URL, OAUTH_ENV);
  return discovered;
}
async function ensureClient(meta) {
  if (process.env.MAGNIFIC_OAUTH_CLIENT_ID) {
    return {
      client_id: process.env.MAGNIFIC_OAUTH_CLIENT_ID,
      client_secret: process.env.MAGNIFIC_OAUTH_CLIENT_SECRET,
    };
  }
  if (!clientReg && firestoreStoreAvailable()) {
    // Multi-instance (Cloud Run): all instances must use the SAME OAuth
    // client, or a code issued via instance A can't be exchanged by B.
    try {
      const shared = await fsGet("clientReg");
      if (shared) clientReg = JSON.parse(shared);
    } catch {
      /* fall through to registering */
    }
  }
  if (!clientReg) {
    if (!meta.registration_endpoint) {
      throw new Error("no client_id and no registration_endpoint for DCR");
    }
    clientReg = await registerClient(meta.registration_endpoint, REDIRECT_URI);
    persistClientReg();
    if (firestoreStoreAvailable()) {
      void fsPut("clientReg", JSON.stringify(clientReg)).catch(() => {});
    }
  }
  return clientReg;
}
function storeTokens(sid, tok) {
  sid = keyOf(sid);
  const prev = sessions.get(sid)?.tokens ?? {};
  sessions.set(sid, {
    tokens: {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? prev.refresh_token,
      expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : 0,
    },
  });
  persistSessions();
}
/** Per-user access token, refreshed if expired. Falls back to the static env token. */
async function tokenFor(sid) {
  sid = await resolveKey(sid);
  let s = sessions.get(sid);
  if (!s?.tokens?.access_token) {
    await refreshSharedState();
    s = sessions.get(sid);
  }
  if (!s?.tokens?.access_token) return MCP_STATIC_TOKEN || undefined;
  const t = s.tokens;
  const expired = t.expires_at && Date.now() > t.expires_at - 30_000;
  if (expired && t.refresh_token) {
    const meta = await ensureDiscovery();
    const client = await ensureClient(meta);
    const refreshed = await refreshToken({
      token_endpoint: meta.token_endpoint,
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: t.refresh_token,
      resource: MCP_URL,
    });
    storeTokens(sid, refreshed);
    return sessions.get(sid).tokens.access_token;
  }
  return t.access_token;
}

// --- MCP generation: direct tool calls, async job lifecycle ---
//
// We call the Magnific MCP tools DIRECTLY with the user's OAuth token (the
// generation request is already fully formed by the pipeline/Claude). Tools are
// async: they return a creation identifier; creations_wait long-polls it to a
// terminal state. start -> jobId (immediate) -> poll /mcp-status -> url. No mock:
// always real Magnific, or an honest error.
function newJobId() {
  return `job_${randomBytes(8).toString("hex")}`;
}

const CONTENT_TYPE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
function extFor(url, contentType) {
  try {
    const e = extname(new URL(url).pathname).toLowerCase();
    if (CONTENT_TYPE[e]) return e;
  } catch {
    /* not a parseable url path */
  }
  const ct = contentType ?? "";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("mp4") && ct.includes("audio")) return ".m4a";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("quicktime")) return ".mov";
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("ogg")) return ".ogg";
  return ".bin";
}

/** Download an asset to local disk and return its stable served path. */
async function localizeAsset(name, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const ext = extFor(url, res.headers.get("content-type"));
  const file = `${name}${ext}`;
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(join(STORAGE_DIR, file), Buffer.from(await res.arrayBuffer()));
  return `/api/director/files/${file}`;
}

/** Start a generation: call the Magnific tool, store an async job, return its id. */
async function startGeneration(body, sid) {
  sid = keyOf(sid);
  const { kind, prompt, model, references, libraryRefs, params } = body;
  // No mock: always real Magnific, or an honest error to fix.
  if (!MCP_URL) {
    return { ok: false, status: "failed", error: "MAGNIFIC_MCP_URL no configurado en el server" };
  }
  const token = await tokenFor(sid);
  if (!token) {
    console.log(`[gen] sin token (sid=${sid ? "presente" : "AUSENTE"}) -> pide conectar`);
    return {
      ok: false,
      status: "failed",
      error: "Conecta tu cuenta de Magnific (OAuth) en Ajustes para generar",
    };
  }
  const jobId = newJobId();
  const createdAt = Date.now();

  // TTS needs a voiceId; if the UI didn't pick one, fall back to the first voice.
  let genParams = params;
  if (kind === "audio" && params?.audioType !== "music" && params?.voiceId == null) {
    const voiceId = await firstVoiceId(MCP_URL, token).catch(() => undefined);
    if (voiceId != null) genParams = { ...params, voiceId };
  }

  const identifiers = await runGenerationTool(token, { kind, prompt, model, references, libraryRefs, params: genParams });
  const expectedSec = await expectedSecFor(MCP_URL, token, kind, model);
  jobs.set(jobId, { sid, kind, identifiers, status: "rendering", expectedSec, createdAt });
  persistJobs();
  return { ok: true, jobId, status: "rendering", expectedSec };
}

/** Pick a video model that accepts an image REFERENCE (for keyframe-driven gen). */
async function pickImageRefVideoModel(mcpUrl, token) {
  try {
    const list = await listModels(mcpUrl, token, "video");
    const refModels = list.filter((m) => m.slug && m.slug !== "auto" && m.imageRef);
    return (refModels.find((m) => m.recommended) ?? refModels[0])?.slug;
  } catch {
    return undefined;
  }
}

/**
 * Call the generation tool and return the creation identifiers. For a video WITH
 * a keyframe we ensure the model accepts an image reference (switching to a
 * ref-capable model when needed), then use the keyframe as a content reference.
 */
async function runGenerationTool(token, { kind, prompt, model, references, libraryRefs, params }) {
  const callOnce = async (refs, extra, libRefs = libraryRefs) => {
    const { tool, args } = buildGenerationCall(kind, {
      prompt,
      model,
      references: refs,
      libraryRefs: libRefs,
      params: { ...params, ...extra },
    });
    console.log(`[gen] ${tool} model=${model} refMode=${extra?.imageRefMode ?? "-"} libRefs=${(libRefs ?? []).length}`);
    const result = await callTool(MCP_URL, token, tool, args);
    const ids = extractIdentifiers(result);
    if (!ids.length) {
      console.error(`[gen] ${tool} no-id raw:`, JSON.stringify(result).slice(0, 600));
    }
    return ids;
  };

  // Image / concat / video without a keyframe: a single call.
  if (kind !== "video" || !references?.length) {
    let ids = await callOnce(references, {});
    // Some image models reject library references (character/locations/style) and
    // return no creation. Fall back to generating WITHOUT them so it doesn't
    // hard-fail (consistency is reduced; use a ref-capable model like Auto for it).
    if (!ids.length && (libraryRefs?.length ?? 0) > 0) {
      console.warn(`[gen] ${kind} model=${model} returned no id with ${libraryRefs.length} library ref(s); retrying without them`);
      ids = await callOnce(references, {}, []);
    }
    if (!ids.length) throw new Error(`no creation identifier returned for ${kind}`);
    return ids;
  }

  // Video with a keyframe MUST run on a model that accepts an image reference,
  // so the keyframe is actually used (consistency). If the model is "auto" or
  // doesn't support refs, switch to a ref-capable one.
  const explicit = params?.imageRefMode; // user choice from the UI, if any
  let supportsRef =
    model && model !== "auto" ? await modelSupportsImageRef(MCP_URL, token, kind, model) : false;
  if (!supportsRef) {
    const refModel = await pickImageRefVideoModel(MCP_URL, token);
    if (refModel) {
      console.log(`[gen] video+keyframe: model "${model}" → "${refModel}" (image-ref capable)`);
      model = refModel;
      supportsRef = true;
    }
  }
  const order = explicit
    ? [explicit, explicit === "reference" ? "keyframe" : "reference"]
    : supportsRef
      ? ["reference", "keyframe"]
      : ["keyframe", "reference"];

  // BOTH modes (reference and keyframe/start-frame) need the keyframe's real
  // asset URL — passing the raw creation id in `url` silently yields no creation.
  // Resolve it reliably (creations_get, then creations_wait).
  let refUrls;
  const resolveRefUrls = async () => {
    if (refUrls) return refUrls;
    refUrls = [];
    for (const id of references) {
      const url = await creationAssetUrlWait(MCP_URL, token, id);
      if (url) refUrls.push(url);
    }
    return refUrls;
  };

  let lastErr;
  for (const mode of order) {
    try {
      const refs = await resolveRefUrls();
      if (!refs.length) {
        lastErr = "no se pudo resolver la URL del keyframe";
        console.error(`[gen] ${lastErr}`);
        break;
      }
      const ids = await callOnce(refs, { imageRefMode: mode });
      if (ids.length) return ids;
      lastErr = `sin identifier (refMode=${mode})`;
      console.error(`[gen] ${mode}: ${lastErr}`);
    } catch (e) {
      lastErr = String(e?.message ?? e);
      console.error(`[gen] ${mode} error: ${lastErr.slice(0, 300)}`);
    }
  }
  throw new Error(lastErr || "video generation failed");
}

function settleResponse(job, progress) {
  return {
    ok: job.status === "ready",
    status: job.status,
    progress,
    resultUrl: job.resultUrl,
    identifier: job.identifiers?.[0],
    credits: job.credits ?? 0,
    model: job.model,
    error: job.status === "failed" ? job.error ?? "failed" : undefined,
    note: job.note,
  };
}

/**
 * Advance ONE rendering job by polling the creation; settle it (ready/failed,
 * download asset, real credits/model) when terminal. Mutates the job. Used by
 * both /mcp-status (client poll) and the background sweeper (so jobs finish even
 * if the client closes/reloads). Throws only on transient errors (caller stays).
 */
async function advanceJob(jobId, job) {
  const token = await tokenFor(job.sid);
  if (!token) return;
  const res = await callTool(MCP_URL, token, "creations_wait", {
    identifiers: job.identifiers.slice(0, 8),
    timeoutSeconds: 10,
  });
  const c = readCreation(res);
  if (c.status === "ready" && c.url) {
    job.status = "ready";
    let credits = c.credits ?? 0;
    try {
      const info = await creationInfo(MCP_URL, token, job.identifiers[0]);
      if (info.credits != null) credits = info.credits;
      if (info.model) job.model = await resolveSlug(MCP_URL, token, job.kind, info.model);
    } catch {
      /* keep what we have */
    }
    job.credits = credits;
    // Local-first: the server never stores content. Keep Magnific's signed URL
    // and hand the client a one-shot streaming proxy; the browser saves the
    // bytes on the user's machine. (The proxy re-resolves if the URL expires.)
    job.assetUrl = c.url;
    job.resultUrl = `/api/director/asset?job=${encodeURIComponent(jobId)}`;
    console.log(`[poll] ${jobId} ready credits=${credits} model=${job.model ?? "?"}`);
    persistJobs();
  } else if (c.status === "failed") {
    job.status = "failed";
    let reason = c.error;
    try {
      const got = await callTool(MCP_URL, token, "creations_get", {
        creationIdentifier: job.identifiers[0],
      });
      reason = readCreation(got).error ?? reason;
    } catch {
      /* ignore */
    }
    job.error = reason ? `Magnific: ${reason}` : "La generación falló en Magnific.";
    console.error(`[poll] ${jobId} failed -> ${job.error}`);
    persistJobs();
  }
}

/** Poll a job for the client: advance it if rendering, return its state. */
async function pollJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, status: "failed", progress: 100, error: "unknown job" };
  if (job.status === "rendering") {
    try {
      await advanceJob(jobId, job);
    } catch (e) {
      // Transient — stay rendering.
      const elapsed = (Date.now() - job.createdAt) / 1000;
      const estimate = Math.min(95, Math.round((elapsed / Math.max(1, job.expectedSec)) * 100));
      return { ok: true, status: "rendering", progress: Math.max(estimate, 10), note: String(e?.message ?? e) };
    }
  }
  if (job.status === "ready" || job.status === "failed") return settleResponse(job, 100);
  const elapsed = (Date.now() - job.createdAt) / 1000;
  const estimate = Math.min(95, Math.round((elapsed / Math.max(1, job.expectedSec)) * 100));
  return { ok: true, status: "rendering", progress: Math.max(estimate, 10) };
}

// Background sweeper: finishes rendering jobs even with no client polling, so a
// closed/reloaded tab doesn't lose generations.
let sweeping = false;
async function sweep() {
  if (sweeping || !MCP_URL) return;
  sweeping = true;
  try {
    for (const [jobId, job] of jobs) {
      if (job.status !== "rendering") continue;
      // Drop ancient stuck jobs (>30 min) so they don't poll forever.
      if (Date.now() - job.createdAt > 30 * 60 * 1000) {
        job.status = "failed";
        job.error = "Tiempo agotado.";
        persistJobs();
        continue;
      }
      try {
        await advanceJob(jobId, job);
      } catch {
        /* transient; retry next sweep */
      }
    }
  } finally {
    sweeping = false;
  }
}

// Ephemeral render workspace under /tmp, scoped per session so another session
// can't read or inject inputs. Deleted after each render.
const MAX_CONCURRENT_RENDERS = 1;
let renderBusy = 0;
function renderDirFor(sid, rid) {
  const scope = createHash("sha256").update(String(keyOf(sid) ?? "anon")).digest("hex").slice(0, 12);
  return join(tmpdir(), `ms_render_${scope}_${rid}`);
}

// Never let an uncaught error take the process down (would 500 every request).
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

// --- Routes ---
const server = createServer((req, res) => {
  void handle(req, res).catch((e) => {
    console.error(`[http] ${req.method} ${req.url} ->`, e instanceof Error ? e.stack : e);
    try {
      json(res, 200, { ok: false, status: "failed", error: String(e?.message ?? e) });
    } catch {
      /* response already sent */
    }
  });
});

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  // CSRF hardening: cookie-authed mutating routes must come from our origin.
  // (SameSite=Lax covers navigation; this closes cross-origin fetch/form posts.)
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== ALLOW_ORIGIN && origin !== APP_ORIGIN) {
      return json(res, 403, { ok: false, error: "origin no permitido" });
    }
  }

  if (req.method === "GET" && (path === "/health" || path === "/api/director/health")) {
    return json(res, 200, {
      ok: true,
      anthropic: !!ANTHROPIC_API_KEY,
      mcp: !!MCP_URL,
      model: ANTHROPIC_MODEL,
      redirect_uri: REDIRECT_URI,
    });
  }

  // OAuth: status
  if (req.method === "GET" && path === "/api/director/auth/status") {
    const sid = sidOf(req);
    let tokens = sid ? sessions.get(await resolveKey(sid))?.tokens : undefined;
    if (!tokens?.access_token && sid) {
      await refreshSharedState();
      tokens = sessions.get(keyOf(sid))?.tokens;
    }
    return json(res, 200, {
      connected: !!tokens?.access_token,
      configured: !!MCP_URL,
      expiresAt: tokens?.expires_at ?? null,
    });
  }

  // OAuth: begin login -> redirect user to Magnific
  if (req.method === "GET" && path === "/api/director/auth/login") {
    if (!MCP_URL) {
      return redirect(res, `${APP_ORIGIN}/?magnific=unconfigured`);
    }
    try {
      const meta = await ensureDiscovery();
      const client = await ensureClient(meta);
      const sid = ensureSid(req);
      const state = randomState();
      const { verifier, challenge } = pkce();
      pending.set(state, { sid, verifier });
      // Cloud Run can route the callback to ANOTHER instance — share the
      // in-flight PKCE state so any instance can complete the exchange.
      if (firestoreStoreAvailable()) {
        await fsPut(`pending_${state}`, JSON.stringify({ sid, verifier })).catch(() => {});
      }
      const scope =
        OAUTH_ENV.SCOPE ?? (meta.scopes_supported ? meta.scopes_supported.join(" ") : undefined);
      const authUrl = authorizeUrl({
        authorization_endpoint: meta.authorization_endpoint,
        client_id: client.client_id,
        redirectUri: REDIRECT_URI,
        state,
        challenge,
        scope,
        resource: MCP_URL,
      });
      return redirect(res, authUrl, { "set-cookie": sidCookie(sid) });
    } catch (e) {
      return redirect(res, `${APP_ORIGIN}/?magnific=error&detail=${encodeURIComponent(String(e.message ?? e))}`);
    }
  }

  // OAuth: callback -> exchange code, store tokens, return to app
  if (req.method === "GET" && path === "/api/director/auth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    let p = state ? pending.get(state) : undefined;
    if (!p && state && firestoreStoreAvailable()) {
      // The login redirect may have been served by a different instance.
      try {
        const shared = await fsGet(`pending_${state}`);
        if (shared) p = JSON.parse(shared);
      } catch {
        /* fall through to bad_callback */
      }
    }
    if (!code || !p) {
      return redirect(res, `${APP_ORIGIN}/?magnific=error&detail=bad_callback`);
    }
    pending.delete(state);
    if (firestoreStoreAvailable()) void fsDelete(`pending_${state}`).catch(() => {});
    try {
      const meta = await ensureDiscovery();
      const client = await ensureClient(meta);
      const tok = await exchangeCode({
        token_endpoint: meta.token_endpoint,
        client_id: client.client_id,
        client_secret: client.client_secret,
        code,
        verifier: p.verifier,
        redirectUri: REDIRECT_URI,
        resource: MCP_URL,
      });
      storeTokens(p.sid, tok);
      return redirect(res, `${APP_ORIGIN}/?magnific=connected`, {
        "set-cookie": sidCookie(p.sid),
      });
    } catch (e) {
      return redirect(res, `${APP_ORIGIN}/?magnific=error&detail=${encodeURIComponent(String(e.message ?? e))}`);
    }
  }

  // OAuth: logout (Magnific disconnect for THIS user/session key)
  if (req.method === "POST" && path === "/api/director/auth/logout") {
    const sid = sidOf(req);
    if (sid) {
      sessions.delete(keyOf(sid));
      persistSessions();
    }
    return json(res, 200, { ok: true });
  }

  // Identity: bind (or unbind) the msid session to a verified Firebase user.
  // The SPA posts its ID token after Google sign-in and on every refresh.
  if (req.method === "POST" && path === "/api/director/auth/firebase") {
    const sid = ensureSid(req);
    try {
      const body = await readBody(req);
      if (!body.idToken) {
        userBySid.delete(sid);
        persistUsers();
        return json(res, 200, { ok: true, uid: null }, { "set-cookie": sidCookie(sid) });
      }
      if (!FIREBASE_PROJECT_ID) {
        return json(res, 200, { ok: false, error: "FIREBASE_PROJECT_ID no configurado en el server" });
      }
      const { uid, email } = await verifyFirebaseIdToken(body.idToken, FIREBASE_PROJECT_ID);
      const hadAnon = sessions.get(sid);
      userBySid.set(sid, { uid, email });
      persistUsers();
      // If Magnific was connected BEFORE logging in (anonymous key), migrate
      // that session to the user key so the connection isn't "lost" on login.
      if (hadAnon && !sessions.get(`uid:${uid}`)) {
        sessions.set(`uid:${uid}`, hadAnon);
        sessions.delete(sid);
        persistSessions();
      }
      return json(res, 200, { ok: true, uid }, { "set-cookie": sidCookie(sid) });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Generation: START — returns a job id immediately (async by design).
  if (req.method === "POST" && path === "/api/director/mcp-generate") {
    if (rateLimited(keyOf(sidOf(req)), "generate", 30, 5 * 60 * 1000)) {
      return json(res, 200, { ok: false, status: "failed", error: "Demasiadas generaciones seguidas; espera unos minutos." });
    }
    try {
      const body = await readBody(req);
      if (!body.prompt || !body.kind) {
        return json(res, 400, { ok: false, error: "kind and prompt required" });
      }
      const sid = sidOf(req);
      return json(res, 200, await startGeneration(body, sid));
    } catch (e) {
      console.error(`[gen] ERROR:`, e instanceof Error ? e.stack : String(e));
      return json(res, 200, {
        ok: false,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Generation: STATUS — poll a job until ready/failed.
  if (req.method === "GET" && path === "/api/director/mcp-status") {
    const jobId = url.searchParams.get("job");
    if (!jobId) return json(res, 400, { ok: false, error: "job required" });
    // Session-scoped: a session can only observe its own jobs (legacy jobs
    // created before scoping have no sid and stay reachable).
    const owned = jobs.get(jobId);
    if (owned?.sid && owned.sid !== keyOf(sidOf(req))) {
      return json(res, 200, { ok: false, status: "failed", error: "unknown job" });
    }
    try {
      return json(res, 200, await pollJob(jobId));
    } catch (e) {
      return json(res, 200, {
        ok: true,
        status: "rendering",
        progress: 50,
        note: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // One-shot streaming proxy for a finished job's asset (local-first: the
  // server never stores content — it pipes Magnific's bytes to the browser,
  // which saves them on the user's machine). Session-scoped: only the session
  // that started the job can fetch it. Re-resolves the URL if it expired.
  if (req.method === "GET" && path === "/api/director/asset") {
    const jobId = url.searchParams.get("job");
    const job = jobId ? jobs.get(jobId) : undefined;
    const sid = keyOf(sidOf(req));
    if (!job || (job.sid && job.sid !== sid)) {
      return json(res, 404, { ok: false, error: "unknown job" });
    }
    if (job.status !== "ready" || !job.assetUrl) {
      return json(res, 409, { ok: false, error: "asset not ready" });
    }
    cors(res);
    const pipeFrom = async (assetUrl) => {
      const upstream = await fetch(assetUrl);
      if (!upstream.ok || !upstream.body) return upstream.status;
      res.writeHead(200, {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        ...(upstream.headers.get("content-length")
          ? { "content-length": upstream.headers.get("content-length") }
          : {}),
        "cache-control": "no-store",
      });
      const { Readable } = await import("node:stream");
      Readable.fromWeb(upstream.body).pipe(res);
      return 200;
    };
    let status = await pipeFrom(job.assetUrl).catch(() => 0);
    if (status !== 200 && !res.headersSent) {
      // Signed URL likely expired — resolve a fresh one from the creation.
      try {
        const token = await tokenFor(job.sid);
        const fresh = token
          ? await creationAssetUrlWait(MCP_URL, token, job.identifiers[0])
          : undefined;
        if (fresh) {
          job.assetUrl = fresh;
          persistJobs();
          status = await pipeFrom(fresh);
        }
      } catch {
        /* fall through to 502 */
      }
      if (status !== 200 && !res.headersSent) {
        return json(res, 502, { ok: false, error: "no se pudo descargar el asset" });
      }
    }
    return;
  }

  // Serve a locally-stored generated asset (durable; replaces expiring URLs).
  if (req.method === "GET" && path.startsWith("/api/director/files/")) {
    const name = basename(path.slice("/api/director/files/".length));
    const full = join(STORAGE_DIR, name);
    if (!full.startsWith(STORAGE_DIR + (STORAGE_DIR.endsWith("/") ? "" : "/")) || !existsSync(full)) {
      return json(res, 404, { ok: false, error: "not found" });
    }
    cors(res);
    const ctype = CONTENT_TYPE[extname(full).toLowerCase()] ?? "application/octet-stream";
    const total = statSync(full).size;
    const cache = "public, max-age=31536000, immutable";
    // Honor HTTP Range so the browser can SEEK within video/audio (needed for the
    // timeline preview/scrub and <video controls>); without 206 frames stay black.
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        "content-type": ctype,
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
        "cache-control": cache,
      });
      return createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      "content-type": ctype,
      "content-length": total,
      "accept-ranges": "bytes",
      "cache-control": cache,
    });
    return createReadStream(full).pipe(res);
  }

  // Restore an asset to local disk on import (base64) -> stable served URL.
  if (req.method === "POST" && path === "/api/director/upload") {
    try {
      const body = await readBody(req);
      if (!body.base64) return json(res, 400, { ok: false, error: "base64 required" });
      const ext = (extname(String(body.name ?? "")).toLowerCase() || ".bin").slice(0, 6);
      const file = `imp_${randomBytes(8).toString("hex")}${ext}`;
      await mkdir(STORAGE_DIR, { recursive: true });
      await writeFile(join(STORAGE_DIR, file), Buffer.from(body.base64, "base64"));
      return json(res, 200, { ok: true, url: `/api/director/files/${file}` });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Account plan + credits (for Settings).
  if (req.method === "GET" && path === "/api/director/account") {
    const sid = sidOf(req);
    const token = MCP_URL ? await tokenFor(sid).catch(() => undefined) : undefined;
    if (!token) return json(res, 200, { ok: false, connected: false });
    try {
      return json(res, 200, { ok: true, ...(await accountBalance(MCP_URL, token)) });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Backend capabilities (e.g. whether native ffmpeg is available for render).
  if (req.method === "GET" && path === "/api/director/capabilities") {
    return json(res, 200, { ok: true, ffmpeg: await hasFfmpeg() });
  }

  // Ephemeral render input upload (local-first): the browser holds the clip
  // bytes, so it uploads each input to a per-session /tmp dir before /render.
  // Raw binary body; capped size; the whole dir is deleted after the render.
  if (req.method === "POST" && path === "/api/director/render-input") {
    const sid = sidOf(req);
    const rid = url.searchParams.get("render") ?? "";
    const name = basename(url.searchParams.get("name") ?? "");
    if (!sid) return json(res, 401, { ok: false, error: "sesión requerida" });
    if (rateLimited(keyOf(sid), "render-input", 120, 10 * 60 * 1000)) {
      return json(res, 429, { ok: false, error: "Demasiadas subidas; espera unos minutos." });
    }
    if (!/^[a-z0-9]{6,32}$/.test(rid) || !name) {
      return json(res, 400, { ok: false, error: "render id o name inválido" });
    }
    const dir = renderDirFor(sid, rid);
    await mkdir(dir, { recursive: true });
    try {
      await new Promise((resolvep, rejectp) => {
        const MAX = 300 * 1024 * 1024; // 300 MB per input
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
          size += c.length;
          if (size > MAX) {
            req.destroy();
            rejectp(new Error("input demasiado grande (máx 300MB)"));
            return;
          }
          chunks.push(c);
        });
        req.on("end", () => {
          writeFile(join(dir, name), Buffer.concat(chunks)).then(resolvep, rejectp);
        });
        req.on("error", rejectp);
      });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Local timeline render with ffmpeg (trim + concat + voice/music mux).
  if (req.method === "POST" && path === "/api/director/render") {
    if (rateLimited(keyOf(sidOf(req)), "render", 6, 10 * 60 * 1000)) {
      return json(res, 200, { ok: false, error: "Demasiados renders seguidos; espera unos minutos." });
    }
    try {
      if (!(await hasFfmpeg())) {
        return json(res, 200, {
          ok: false,
          error: "ffmpeg no está instalado en el servidor. Instálalo con: brew install ffmpeg",
        });
      }
      const body = await readBody(req);

      // New ephemeral mode: inputs were uploaded to /tmp via /render-input;
      // render there, STREAM the mp4 back, and delete everything. The server
      // keeps no content.
      if (body.render) {
        if (renderBusy >= MAX_CONCURRENT_RENDERS) {
          return json(res, 200, { ok: false, error: "Hay un render en curso; prueba en unos segundos." });
        }
        renderBusy++;
        const sid = sidOf(req);
        const dir = renderDirFor(sid, String(body.render));
        try {
          const fileIn = (f) => {
            const p = join(dir, basename(String(f ?? "")));
            if (!existsSync(p)) throw new Error(`falta el input ${f}`);
            return p;
          };
          const clips = (body.clips ?? []).map((c) => ({
            path: fileIn(c.file),
            inSec: c.inSec,
            outSec: c.outSec,
            mute: !!c.mute,
          }));
          if (clips.length === 0) return json(res, 200, { ok: false, error: "No hay clips para ensamblar" });
          const audio = (body.audio ?? []).map((a) => ({
            path: fileIn(a.file),
            offsetSec: a.offsetSec,
            volume: a.volume,
            inSec: a.inSec,
            outSec: a.outSec,
          }));
          const outPath = join(dir, "final.mp4");
          console.log(`[render] efímero: ${clips.length} clips, ${audio.length} pistas`);
          await renderTimeline({ clips, audio, muteVideo: !!body.muteVideo }, { workDir: join(dir, "work"), outPath });
          cors(res);
          const total = (await stat(outPath)).size;
          res.writeHead(200, {
            "content-type": "video/mp4",
            "content-length": total,
            "cache-control": "no-store",
          });
          await new Promise((done) => {
            const s = createReadStream(outPath);
            s.pipe(res);
            s.on("close", done);
            s.on("error", done);
          });
          return;
        } finally {
          renderBusy--;
          void cleanupDir(dir);
        }
      }
      // Map served/remote urls → local file paths the renderer can read.
      const toLocal = async (urlOrPath) => {
        if (!urlOrPath) return undefined;
        const marker = "/api/director/files/";
        const at = String(urlOrPath).indexOf(marker);
        if (at >= 0) return join(STORAGE_DIR, basename(String(urlOrPath).slice(at + marker.length)));
        if (/^https?:/.test(urlOrPath)) {
          const served = await localizeAsset(`dl_${randomBytes(6).toString("hex")}`, urlOrPath);
          return join(STORAGE_DIR, basename(served));
        }
        throw new Error(`asset no localizable: ${urlOrPath}`);
      };
      const clips = [];
      for (const c of body.clips ?? []) {
        const p = await toLocal(c.url);
        if (p) clips.push({ path: p, inSec: c.inSec, outSec: c.outSec, mute: !!c.mute });
      }
      if (clips.length === 0) return json(res, 200, { ok: false, error: "No hay clips para ensamblar" });
      const audio = [];
      for (const a of body.audio ?? []) {
        const p = await toLocal(a.url);
        if (p) audio.push({ path: p, offsetSec: a.offsetSec, volume: a.volume, inSec: a.inSec, outSec: a.outSec });
      }
      const id = randomBytes(8).toString("hex");
      const workDir = join(STORAGE_DIR, `render_${id}`);
      const outFile = `final_${id}.mp4`;
      const outPath = join(STORAGE_DIR, outFile);
      console.log(`[render] ${clips.length} clips, ${audio.length} pistas de audio → ${outFile}`);
      await renderTimeline({ clips, audio, muteVideo: !!body.muteVideo }, { workDir, outPath });
      await cleanupDir(workDir);
      return json(res, 200, { ok: true, url: `/api/director/files/${outFile}` });
    } catch (e) {
      console.error("[render] error:", e);
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // TTS voice catalog for the Audio UI selector.
  if (req.method === "GET" && path === "/api/director/voices") {
    const sid = sidOf(req);
    const token = MCP_URL ? await tokenFor(sid).catch(() => undefined) : undefined;
    if (!token) return json(res, 200, { ok: false, voices: [] });
    try {
      const search = url.searchParams.get("q") || undefined;
      return json(res, 200, { ok: true, voices: await listVoices(MCP_URL, token, search) });
    } catch (e) {
      return json(res, 200, { ok: false, voices: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  // List the user's existing Magnific Library assets (to browse/reuse).
  if (req.method === "GET" && path === "/api/director/library-list") {
    const sid = sidOf(req);
    const token = MCP_URL ? await tokenFor(sid).catch(() => undefined) : undefined;
    if (!token) return json(res, 200, { ok: false, assets: [] });
    try {
      const type = url.searchParams.get("type") || undefined;
      const search = url.searchParams.get("q") || undefined;
      return json(res, 200, { ok: true, assets: await listLibrary(MCP_URL, token, { type, search }) });
    } catch (e) {
      return json(res, 200, { ok: false, assets: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Upload a user image as a Magnific creation (for library references).
  // Body: { base64, mime }. Returns { ok, identifier }.
  if (req.method === "POST" && path === "/api/director/upload-creation") {
    try {
      const body = await readBody(req);
      const sid = sidOf(req);
      const token = MCP_URL ? await tokenFor(sid).catch(() => undefined) : undefined;
      if (!token) {
        return json(res, 200, { ok: false, needsMagnific: true, error: "Conecta tu cuenta de Magnific (OAuth) en Ajustes" });
      }
      const mime = String(body.mime ?? "image/png");
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        return json(res, 200, { ok: false, error: "Formato no soportado (JPEG, PNG o WebP)" });
      }
      const buffer = Buffer.from(String(body.base64 ?? ""), "base64");
      if (buffer.length === 0) return json(res, 200, { ok: false, error: "base64 required" });
      if (buffer.length > 25 * 1024 * 1024) return json(res, 200, { ok: false, error: "Imagen demasiado grande (máx 25MB)" });
      const identifier = await uploadCreationBytes(MCP_URL, token, { buffer, mime });
      return json(res, 200, { ok: true, identifier });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Create a reusable Library asset (character) from a keyframe/image, for
  // visual consistency. Body: { name, type, description?, images: [{creationIdentifier|url}] }.
  if (req.method === "POST" && path === "/api/director/library-create") {
    try {
      const body = await readBody(req);
      const sid = sidOf(req);
      const token = MCP_URL ? await tokenFor(sid) : undefined;
      if (!token) {
        return json(res, 200, { ok: false, error: "Conecta tu cuenta de Magnific (OAuth) en Ajustes" });
      }
      const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
      if (!body.name || !body.type || images.length === 0) {
        return json(res, 200, { ok: false, error: "Faltan name, type o images" });
      }
      const out = await createLibraryAsset(MCP_URL, token, {
        name: String(body.name).slice(0, 50).replace(/[^A-Za-z0-9_-]/g, "-"),
        type: body.type,
        description: body.description,
        images,
      });
      if (!out.identifier) return json(res, 200, { ok: false, error: "Magnific no devolvió un identificador de biblioteca" });
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Real credit cost for a set of creation identifiers (sums creations_get).
  if (req.method === "POST" && path === "/api/director/credits") {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(Boolean))] : [];
      const sid = sidOf(req);
      const token = MCP_URL ? await tokenFor(sid) : undefined;
      if (!token || ids.length === 0) {
        return json(res, 200, { ok: true, total: 0, perId: {} });
      }
      const perId = {};
      let total = 0;
      for (const id of ids) {
        try {
          const { credits } = await creationInfo(MCP_URL, token, id);
          if (credits != null) {
            perId[id] = credits;
            total += credits;
          }
        } catch {
          /* skip one that can't be read */
        }
      }
      return json(res, 200, { ok: true, total, perId });
    } catch (e) {
      return json(res, 200, { ok: false, total: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Model catalog for the UI selector (live when connected, else static).
  if (req.method === "GET" && path === "/api/director/models") {
    const kind = url.searchParams.get("kind") === "video" ? "video" : "image";
    const sid = sidOf(req);
    const token = MCP_URL ? await tokenFor(sid).catch(() => undefined) : undefined;
    try {
      return json(res, 200, { ok: true, kind, models: await listModels(MCP_URL, token, kind) });
    } catch (e) {
      return json(res, 200, {
        ok: false,
        kind,
        models: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Static SPA (production): serve the built dist/ same-origin so there is no
  // CORS and the cookie flow just works. API routes were handled above.
  if ((req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api/")) {
    let file = resolve(join(DIST_DIR, decodeURIComponent(path).slice(1)));
    // Only serve real files inside dist/; anything else falls back to the SPA.
    if (!file.startsWith(DIST_DIR) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(DIST_DIR, "index.html");
    }
    if (existsSync(file)) {
      const ctype = CONTENT_TYPE[extname(file).toLowerCase()] ?? "application/octet-stream";
      const immutable = /assets\//.test(file);
      res.writeHead(200, {
        "content-type": ctype,
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      });
      return createReadStream(file).pipe(res);
    }
  }

  json(res, 404, { ok: false, error: "not found" });
}

loadClientReg();
loadSessions();
loadUsers();
void restoreFromFirestore();
loadJobs();
// Finish rendering jobs autonomously (survives client close/reload).
setInterval(() => void sweep(), 8000);
server.listen(PORT, () => {
  console.log(
    `[director] :${PORT}  anthropic=${!!ANTHROPIC_API_KEY} mcp=${!!MCP_URL} redirect=${REDIRECT_URI}`,
  );
});
