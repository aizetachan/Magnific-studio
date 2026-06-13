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
import { randomBytes } from "node:crypto";
import {
  authorizeUrl,
  discover,
  exchangeCode,
  pkce,
  randomState,
  refreshToken,
  registerClient,
} from "./oauth.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:5173";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? APP_ORIGIN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
const MCP_URL = process.env.MAGNIFIC_MCP_URL ?? "";
const MCP_STATIC_TOKEN = process.env.MAGNIFIC_MCP_TOKEN ?? "";
const REDIRECT_URI = `${APP_ORIGIN}/api/director/auth/callback`;
const OAUTH_ENV = {
  AUTH_URL: process.env.MAGNIFIC_OAUTH_AUTH_URL,
  TOKEN_URL: process.env.MAGNIFIC_OAUTH_TOKEN_URL,
  REGISTRATION_URL: process.env.MAGNIFIC_OAUTH_REGISTRATION_URL,
  SCOPE: process.env.MAGNIFIC_OAUTH_SCOPE,
};

const TOOL_HINT = {
  image: "images_generate (or images_variations) to create the image",
  video: "video_generate to create the video clip",
  concat: "video_concatenate to assemble clips into one video",
  audio: "audio_tts or audio_music_generate for audio",
  edit: "the appropriate Magnific edit tool",
  upscale: "images_upscale or video_upscale",
};

// --- In-memory stores (swap for a real store in production) ---
const sessions = new Map(); // sid -> { tokens: {access_token, refresh_token, expires_at} }
const pending = new Map(); // state -> { sid, verifier }
let clientReg = null; // { client_id, client_secret } cached for this process
let discovered = null; // discovered endpoints, cached

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
function sidCookie(sid) {
  return `msid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
}
function ensureSid(req) {
  return getCookie(req, "msid") ?? randomBytes(16).toString("hex");
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
  if (!clientReg) {
    if (!meta.registration_endpoint) {
      throw new Error("no client_id and no registration_endpoint for DCR");
    }
    clientReg = await registerClient(meta.registration_endpoint, REDIRECT_URI);
  }
  return clientReg;
}
function storeTokens(sid, tok) {
  const prev = sessions.get(sid)?.tokens ?? {};
  sessions.set(sid, {
    tokens: {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? prev.refresh_token,
      expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : 0,
    },
  });
}
/** Per-user access token, refreshed if expired. Falls back to the static env token. */
async function tokenFor(sid) {
  const s = sessions.get(sid);
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

// --- MCP generation via Claude's MCP connector ---
const URL_RE = /https?:\/\/[^\s"')]+/;
function extractUrl(content) {
  for (const b of content)
    if (b.type === "mcp_tool_result" && b.content) {
      const m = JSON.stringify(b.content).match(URL_RE);
      if (m) return m[0];
    }
  for (const b of content)
    if (b.type === "text" && b.text) {
      const m = b.text.match(URL_RE);
      if (m) return m[0];
    }
  return undefined;
}
function mockAsset(kind, prompt) {
  const hue = Math.abs([...String(prompt)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='hsl(${hue} 55% 16%)'/><text x='24' y='40' fill='hsl(${hue} 80% 78%)' font-family='monospace' font-size='18'>${String(kind).toUpperCase()} · mock</text><text x='24' y='200' fill='#e8ecff' font-family='sans-serif' font-size='20'>${String(prompt).slice(0, 40).replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function mcpGenerate(body, sid) {
  const { kind, prompt, model, references, params } = body;
  const token = MCP_URL ? await tokenFor(sid) : undefined;
  const live = ANTHROPIC_API_KEY && MCP_URL && token;
  if (!live) {
    return {
      ok: true,
      mocked: true,
      resultUrl: mockAsset(kind, prompt),
      credits: 0,
      note: !ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY not set"
        : !MCP_URL
          ? "MAGNIFIC_MCP_URL not set"
          : "Magnific account not connected (OAuth)",
    };
  }

  const system = [
    "You are the Magnific Studio Director's generation orchestrator.",
    "You have the Magnific MCP tools attached. Execute exactly one generation",
    `for this request using ${TOOL_HINT[kind] ?? "the appropriate Magnific tool"}.`,
    "Do not ask questions. When the asset is ready, reply with a final line:",
    "RESULT_URL: <the asset url>",
  ].join("\n");
  const userParts = [
    `kind: ${kind}`,
    `model: ${model}`,
    references?.length ? `references: ${references.join(", ")}` : "",
    params ? `params: ${JSON.stringify(params)}` : "",
    "",
    prompt,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify({
      model: model?.startsWith("claude") ? model : ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userParts }],
      mcp_servers: [
        { type: "url", name: "magnific", url: MCP_URL, authorization_token: token },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = await res.json();
  const resultUrl = extractUrl(data.content ?? []);
  const usage = data.usage ?? {};
  return {
    ok: !!resultUrl,
    mocked: false,
    resultUrl,
    credits: 0,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    error: resultUrl ? undefined : "no asset URL produced by the MCP tools",
  };
}

// --- Routes ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
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
    const sid = getCookie(req, "msid");
    const tokens = sid ? sessions.get(sid)?.tokens : undefined;
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
    const p = state ? pending.get(state) : undefined;
    if (!code || !p) {
      return redirect(res, `${APP_ORIGIN}/?magnific=error&detail=bad_callback`);
    }
    pending.delete(state);
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

  // OAuth: logout
  if (req.method === "POST" && path === "/api/director/auth/logout") {
    const sid = getCookie(req, "msid");
    if (sid) sessions.delete(sid);
    return json(res, 200, { ok: true });
  }

  // Generation
  if (req.method === "POST" && path === "/api/director/mcp-generate") {
    try {
      const body = await readBody(req);
      if (!body.prompt || !body.kind) {
        return json(res, 400, { ok: false, error: "kind and prompt required" });
      }
      const sid = getCookie(req, "msid");
      return json(res, 200, await mcpGenerate(body, sid));
    } catch (e) {
      return json(res, 200, {
        ok: true,
        mocked: true,
        resultUrl: mockAsset("image", "error fallback"),
        credits: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, () => {
  console.log(
    `[director] :${PORT}  anthropic=${!!ANTHROPIC_API_KEY} mcp=${!!MCP_URL} redirect=${REDIRECT_URI}`,
  );
});
