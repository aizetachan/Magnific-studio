// Magnific Studio — direct MCP client.
//
// The Director executes generation by calling the Magnific MCP tools DIRECTLY
// with the user's per-user OAuth access token (deterministic execution; Claude
// stays the brain for chat/phase reasoning elsewhere). This is what makes async
// production with real job status possible: images_generate / video_generate
// return a creation IDENTIFIER, and creations_wait/creations_get long-poll it to
// a terminal state with the final asset URL.
//
// Transport: Streamable HTTP (the Magnific MCP is OAuth-protected; we inject the
// bearer via requestInit.headers). Clients are cached per token with a short TTL
// so a burst of calls reuses one MCP session; a refreshed token makes a new one.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const CLIENT_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // token -> { client, transport, createdAt }

/** Connect (or reuse) an MCP client authorized with this user's bearer token. */
export async function getClient(mcpUrl, token) {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && now - hit.createdAt < CLIENT_TTL_MS) return hit.client;
  if (hit) await closeQuietly(hit);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "magnific-studio-director", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  cache.set(token, { client, transport, createdAt: now });
  return client;
}

async function closeQuietly(entry) {
  try {
    await entry.client.close();
  } catch {
    /* ignore */
  }
  cache.delete(entryTokenOf(entry));
}
function entryTokenOf(entry) {
  for (const [k, v] of cache) if (v === entry) return k;
  return undefined;
}

// One MCP session per token doesn't handle concurrent tools/call well, so we
// serialize calls per token (the worker-pool fires several at once).
const queues = new Map(); // token -> tail promise

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Magnific rate-limits MCP tool calls ("Too many MCP tool calls. Retry after N
// seconds."). Honor that retry window (with a small jitter) instead of failing.
function rateLimitWaitMs(err) {
  const s = String(err?.message ?? err);
  if (!/too many mcp tool calls|rate.?limit|-32000/i.test(s)) return 0;
  const m = s.match(/retry after\s+(\d+)\s*second/i);
  const sec = m ? Number(m[1]) : 30;
  return Math.min(120, sec) * 1000 + 1000;
}

async function callToolOnce(mcpUrl, token, name, args) {
  const MAX_RL_RETRIES = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const client = await getClient(mcpUrl, token);
      return await client.callTool({ name, arguments: args ?? {} });
    } catch (err) {
      if (isAuthError(err)) {
        const hit = cache.get(token);
        if (hit) await closeQuietly(hit);
        const client = await getClient(mcpUrl, token);
        return await client.callTool({ name, arguments: args ?? {} });
      }
      const waitMs = rateLimitWaitMs(err);
      if (waitMs && attempt < MAX_RL_RETRIES) {
        console.warn(`[mcp] rate-limited on ${name}; waiting ${Math.round(waitMs / 1000)}s (try ${attempt + 1}/${MAX_RL_RETRIES})`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

/** Call a Magnific MCP tool, serialized per token (auth-retry inside). */
export async function callTool(mcpUrl, token, name, args) {
  const prev = queues.get(token) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(() => callToolOnce(mcpUrl, token, name, args));
  // Keep the queue alive even if this call rejects.
  queues.set(
    token,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

function isAuthError(err) {
  const s = String(err?.message ?? err);
  return /401|unauthor|invalid_token|forbidden|expired/i.test(s);
}

// --- Result parsing (defensive: the Magnific relay returns TOON/JSON text) ---

/** Collect plain text from a tool result's content blocks. */
export function textOf(result) {
  const blocks = result?.content ?? [];
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Try to JSON.parse any object embedded in the result (structured or in text). */
function objectsFrom(result) {
  const out = [];
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    out.push(result.structuredContent);
  }
  const text = textOf(result);
  if (text) {
    try {
      out.push(JSON.parse(text));
    } catch {
      // Not pure JSON (often TOON) — fall through to regex extraction.
    }
  }
  return out;
}

/** Recursively collect values for any of the given keys. */
function collectByKey(node, keys, acc) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const v of node) collectByKey(v, keys, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(node)) {
    if (keys.includes(k) && (typeof v === "string" || typeof v === "number")) {
      acc.push(String(v));
    }
    if (v && typeof v === "object") collectByKey(v, keys, acc);
  }
  return acc;
}

/**
 * Best-effort creation identifier(s) from a generation tool result. Magnific
 * returns `{ creations: [{ identifier, ... }] }`. We prefer explicit identifier
 * keys and only fall back to a generic `id` if none are present.
 */
export function extractIdentifiers(result) {
  const ids = new Set();
  for (const obj of objectsFrom(result)) {
    for (const v of collectByKey(obj, ["identifier", "identifiers"], [])) {
      if (v) ids.add(v);
    }
  }
  if (ids.size === 0) {
    for (const obj of objectsFrom(result)) {
      for (const v of collectByKey(obj, ["id"], [])) if (v) ids.add(v);
    }
  }
  return [...ids];
}

// Asset-url keys ONLY — deliberately excludes `webUrl` (the app viewer link,
// present even while queued) so a queued creation is never read as ready.
const URL_KEYS = ["url", "result_url", "resultUrl", "asset_url", "assetUrl", "downloadUrl"];
const TERMINAL_OK = ["completed", "ready", "succeeded", "success", "done"];
const TERMINAL_BAD = ["failed", "error", "cancelled", "canceled", "rejected"];

/**
 * Derive { status, url, credits } from a creations_wait/creations_get result for
 * a single creation. status is "ready" | "failed" | "rendering". Ready requires a
 * real asset url so the pipeline always gets a usable result.
 */
export function readCreation(result) {
  let status, url, credits, model, error;
  for (const obj of objectsFrom(result)) {
    const statuses = collectByKey(obj, ["status", "state"], []);
    const urls = collectByKey(obj, URL_KEYS, []);
    const creditVals = collectByKey(obj, ["credits", "creditsCharged", "cost"], []);
    const models = collectByKey(obj, ["mode", "model", "slug"], []);
    const errs = collectByKey(obj, ["error", "errorMessage", "failureReason", "reason", "message"], []);
    if (statuses.length) status = statuses[statuses.length - 1].toLowerCase();
    const real = urls.find((u) => /^https?:/.test(u));
    if (real) url = real;
    if (creditVals.length) credits = Number(creditVals[0]) || credits;
    if (models.length) model = models[models.length - 1];
    if (errs.length) error = errs[errs.length - 1];
  }
  const text = textOf(result);
  // Text/TOON fallbacks (e.g. `credits: 60`, `mode: recraft-v4-1` in metadata).
  if (credits === undefined) {
    const m = text.match(/\bcredits["']?\s*[:=]\s*(\d+)/i);
    if (m) credits = Number(m[1]);
  }
  if (model === undefined) {
    const m = text.match(/\bmode["']?\s*[:=]\s*["']?([a-z0-9.\-]+)/i);
    if (m) model = m[1];
  }
  let norm = "rendering";
  if (status && TERMINAL_BAD.includes(status)) norm = "failed";
  else if (url && (!status || TERMINAL_OK.includes(status))) norm = "ready";
  return { status: norm, url, credits, model, error, raw: status };
}

/** Real credits + model actually used for a completed creation (creations_get). */
export async function creationInfo(mcpUrl, token, identifier) {
  const got = await callTool(mcpUrl, token, "creations_get", {
    creationIdentifier: identifier,
  });
  const c = readCreation(got);
  return { credits: c.credits, model: c.model };
}

/** The real Magnific asset URL of a creation (needed for video references[].url). */
export async function creationAssetUrl(mcpUrl, token, identifier) {
  const got = await callTool(mcpUrl, token, "creations_get", {
    creationIdentifier: identifier,
  });
  return readCreation(got).url;
}

/**
 * Create a reusable Library asset (character/product/locations) from images.
 * Returns the entry identifier to pass as-is in generation references[].
 */
export async function createLibraryAsset(mcpUrl, token, { name, type, description, images }) {
  const res = await callTool(mcpUrl, token, "library_create", {
    name,
    type,
    ...(description ? { description } : {}),
    images,
  });
  // Prefer an explicit library identifier; fall back to any id in the payload.
  const ids = extractIdentifiers(res);
  let identifier = ids[0];
  let numericId;
  for (const obj of objectsFrom(res)) {
    const found = collectByKey(obj, ["identifier"], []);
    if (found.length) identifier = found[0];
    const nums = collectByKey(obj, ["id"], []);
    if (nums.length) numericId = nums[0];
  }
  return { identifier: identifier ?? numericId, id: numericId, raw: textOf(res) };
}

/** TTS voices catalog → [{ id, name, gender, language }] (tolerant TOON/JSON parse). */
export async function listVoices(mcpUrl, token, search) {
  const res = await callTool(mcpUrl, token, "audio_voices_list", search ? { search } : {});
  const out = [];
  const seen = new Set();
  const push = (id, name, gender, language) => {
    const n = Number(id);
    if (!Number.isFinite(n) || seen.has(n)) return;
    seen.add(n);
    out.push({ id: n, name: name || `Voz ${n}`, gender, language });
  };
  // Structured / JSON objects first.
  for (const obj of objectsFrom(res)) {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.id != null && (node.name != null || node.voiceName != null)) {
        push(node.id, node.name ?? node.voiceName, node.gender, node.language);
      }
      Object.values(node).forEach(walk);
    };
    walk(obj);
  }
  // TOON line fallback: `id: 12, name: Aria, gender: female, ...`
  if (out.length === 0) {
    const text = textOf(res);
    const re = /id["']?\s*[:=]\s*(\d+)[^\n]*?name["']?\s*[:=]\s*["']?([^,"'\n]+)/gi;
    let m;
    while ((m = re.exec(text))) push(m[1], m[2].trim());
  }
  return out;
}

/** First available TTS voice id (for a sensible default when the UI picks none). */
export async function firstVoiceId(mcpUrl, token) {
  const voices = await listVoices(mcpUrl, token);
  return voices[0]?.id;
}

/** Account plan + credits (account_balance), parsed tolerantly (JSON or TOON). */
export async function accountBalance(mcpUrl, token) {
  const res = await callTool(mcpUrl, token, "account_balance", {});
  const text = textOf(res);
  try {
    const j = JSON.parse(text);
    if (j?.credits || j?.plan) return j;
  } catch {
    /* not pure JSON */
  }
  const num = (k) => {
    const m = text.match(new RegExp(`${k}["']?\\s*[:=]\\s*(\\d+)`, "i"));
    return m ? Number(m[1]) : undefined;
  };
  const str = (k) => {
    const m = text.match(new RegExp(`${k}["']?\\s*[:=]\\s*["']?([\\w +.\\-]+)`, "i"));
    return m ? m[1].trim() : undefined;
  };
  return {
    plan: {
      tier: str("tier"),
      productName: str("productName"),
      isUnlimitedMode: /isUnlimitedMode["']?\s*[:=]\s*true/i.test(text),
    },
    credits: { available: num("available"), totalPlan: num("totalPlan"), spent: num("spent") },
  };
}
