// Magnific Studio — Director backend (MCP orchestration).
//
// This is the "Claude orchestrates Magnific MCP" path the brief reserves for
// after the MVP (§5.5, §5.4). It runs Claude (the BRAIN) with the Magnific MCP
// tools attached via Anthropic's MCP connector, server-side — so the OAuth/MCP
// session and both keys stay off the browser. The frontend's McpTransport POSTs
// here; the loop returns the generated asset URL.
//
// Zero dependencies: Node's built-in http + global fetch (Node 18+).
// Graceful by design: with no ANTHROPIC_API_KEY or MCP config, it returns a
// deterministic mock so the app keeps working.
//
// Env:
//   PORT                  (default 8787)
//   ANTHROPIC_API_KEY     server-side Claude key (never sent to the browser)
//   ANTHROPIC_MODEL       default "claude-opus-4-8"
//   MAGNIFIC_MCP_URL      e.g. https://mcp.magnific.com (enables real MCP)
//   MAGNIFIC_MCP_TOKEN    OAuth bearer / token for the MCP server
//   ALLOW_ORIGIN          CORS origin (default "*")

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
const MCP_URL = process.env.MAGNIFIC_MCP_URL ?? "";
const MCP_TOKEN = process.env.MAGNIFIC_MCP_TOKEN ?? "";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*";

const TOOL_HINT = {
  image: "images_generate (or images_variations) to create the image",
  video: "video_generate to create the video clip",
  concat: "video_concatenate to assemble clips into one video",
  audio: "audio_tts or audio_music_generate for audio",
  edit: "the appropriate Magnific edit tool",
  upscale: "images_upscale or video_upscale",
};

function cors(res) {
  res.setHeader("access-control-allow-origin", ALLOW_ORIGIN);
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
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

function mockAsset(kind, prompt) {
  const hue = Math.abs([...prompt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='hsl(${hue} 55% 16%)'/><text x='24' y='40' fill='hsl(${hue} 80% 78%)' font-family='monospace' font-size='18'>${String(kind).toUpperCase()} · mock</text><text x='24' y='200' fill='#e8ecff' font-family='sans-serif' font-size='20'>${prompt.slice(0, 40).replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const URL_RE = /https?:\/\/[^\s"')]+/;

/** Pull the first asset URL out of MCP tool results or the final text. */
function extractUrl(content) {
  for (const block of content) {
    if (block.type === "mcp_tool_result" && block.content) {
      const text = JSON.stringify(block.content);
      const m = text.match(URL_RE);
      if (m) return m[0];
    }
  }
  for (const block of content) {
    if (block.type === "text" && block.text) {
      const m = block.text.match(URL_RE);
      if (m) return m[0];
    }
  }
  return undefined;
}

/** Run Claude with the Magnific MCP connector to produce one asset. */
async function mcpGenerate({ kind, prompt, model, references, params }) {
  const live = ANTHROPIC_API_KEY && MCP_URL;
  if (!live) {
    return {
      ok: true,
      mocked: true,
      resultUrl: mockAsset(kind, prompt),
      credits: 0,
      note: !ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY not set"
        : "MAGNIFIC_MCP_URL not set",
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
        {
          type: "url",
          name: "magnific",
          url: MCP_URL,
          authorization_token: MCP_TOKEN || undefined,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 200)}`);
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

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (
    req.method === "GET" &&
    (req.url === "/health" || req.url === "/api/director/health")
  ) {
    return json(res, 200, {
      ok: true,
      anthropic: !!ANTHROPIC_API_KEY,
      mcp: !!MCP_URL,
      model: ANTHROPIC_MODEL,
    });
  }
  if (req.method === "POST" && req.url === "/api/director/mcp-generate") {
    try {
      const body = await readBody(req);
      if (!body.prompt || !body.kind) {
        return json(res, 400, { ok: false, error: "kind and prompt required" });
      }
      const result = await mcpGenerate(body);
      return json(res, 200, result);
    } catch (e) {
      // Surface a mock so the frontend can degrade gracefully.
      return json(res, 200, {
        ok: true,
        mocked: true,
        resultUrl: mockAsset(req.kind ?? "image", "error fallback"),
        credits: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[director] listening on :${PORT}  (anthropic=${!!ANTHROPIC_API_KEY}, mcp=${!!MCP_URL})`);
});
