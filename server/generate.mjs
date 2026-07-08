// Magnific Studio — generation mapping + model catalog (pure helpers).
//
// Translates the pipeline's flat GenerationRequest (kind/prompt/model/references/
// params) into the exact Magnific MCP tool call, and serves the real model
// catalog (images_models_list / video_models_list) with a static fallback so the
// UI selector works even offline / before the user connects.

import { callTool, textOf } from "./mcpClient.mjs";

const AUTO = (expectedSec) => ({
  slug: "auto",
  name: "Auto (Magnific elige)",
  expectedSec,
  recommended: false,
  mode: undefined,
  imageRef: false,
});

// Real catalog snapshot (slug + friendly name + expected seconds). Used as the
// fallback and to estimate ETA; the live catalog overrides it when connected.
const STATIC_MODELS = {
  image: [
    AUTO(50),
    { slug: "recraft-v4-1", name: "Recraft V4.1", expectedSec: 13, recommended: true, imageRef: true },
    { slug: "imagen-nano-banana-2", name: "Nano Banana Pro", expectedSec: 47, recommended: true, imageRef: true },
    { slug: "imagen-nano-banana-2-flash", name: "Nano Banana 2 (rápido)", expectedSec: 32, recommended: false, imageRef: true },
    { slug: "gpt-2", name: "GPT 2", expectedSec: 63, recommended: false, imageRef: true },
  ],
  video: [
    AUTO(400),
    { slug: "bytedance-seedance-pro-2.0", name: "Seedance 2.0", expectedSec: 300, recommended: true, mode: "pro-2.0", imageRef: true },
    { slug: "kling-25", name: "Kling 2.5", expectedSec: 600, recommended: false, mode: "25", imageRef: false },
    { slug: "bytedance-seedance-fast-2.0", name: "Seedance 2.0 Fast", expectedSec: 300, recommended: false, mode: "fast-2.0", imageRef: true },
  ],
};

const DEFAULT_EXPECTED = { image: 50, video: 400 };
const catalogKey = (kind) => (kind === "video" ? "video" : "image");

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "").trim();
}

/** Parse the lean TOON catalog text from *_models_list into {slug,name,...}[]. */
export function parseModelsToon(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split("\n")) {
    const slugM = line.match(/^\s*-\s*slug:\s*(\S+)/);
    if (slugM) {
      if (cur) out.push(cur);
      cur = {
        slug: stripQuotes(slugM[1]),
        name: stripQuotes(slugM[1]),
        expectedSec: undefined,
        recommended: false,
        mode: undefined,
        imageRef: false, // supports an image as a content reference (not just start frame)
      };
      continue;
    }
    if (!cur) continue;
    const nameM = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (nameM) cur.name = stripQuotes(nameM[1]);
    const etM = line.match(/^\s*expectedGenerationTime:\s*(\d+)/);
    if (etM) cur.expectedSec = Number(etM[1]);
    const modeM = line.match(/^\s*mode:\s*(.+?)\s*$/);
    if (modeM) cur.mode = stripQuotes(modeM[1]);
    if (/tier:\s*sota/.test(line)) cur.recommended = true;
    // Image REFERENCE support: references use `type: image` / compact `image,true`
    // (keyframes use `assetType: image`, which the \btype: boundary excludes).
    if (/\btype:\s*image\b/.test(line) || /^\s*image,true/.test(line)) cur.imageRef = true;
  }
  if (cur) out.push(cur);
  return out;
}

const cache = { image: null, video: null };
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Model catalog for the UI selector. Live when connected, else static. */
export async function listModels(mcpUrl, token, kind) {
  const k = catalogKey(kind);
  const hit = cache[k];
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.list;

  let list = STATIC_MODELS[k];
  if (mcpUrl && token) {
    try {
      const tool = k === "video" ? "video_models_list" : "images_models_list";
      const res = await callTool(mcpUrl, token, tool, {});
      const parsed = parseModelsToon(textOf(res));
      if (parsed.length) list = [AUTO(DEFAULT_EXPECTED[k]), ...parsed];
    } catch {
      // keep the static fallback
    }
  }
  cache[k] = { at: Date.now(), list };
  return list;
}

/** Whether a model can take the image as a content REFERENCE (vs only start frame). */
export async function modelSupportsImageRef(mcpUrl, token, kind, slug) {
  if (!slug || slug === "auto") return false; // unknown model → safe start-frame
  try {
    const list = await listModels(mcpUrl, token, kind);
    return !!list.find((m) => m.slug === slug)?.imageRef;
  } catch {
    return false;
  }
}

/** Map a provider mode (e.g. "pro-2.0") to the Magnific slug (e.g. seedance-pro-2.0). */
export async function resolveSlug(mcpUrl, token, kind, value) {
  if (!value) return value;
  try {
    const list = await listModels(mcpUrl, token, kind);
    if (list.find((m) => m.slug === value)) return value; // already a slug
    const byMode = list.find((m) => m.mode && m.mode === value);
    return byMode ? byMode.slug : value;
  } catch {
    return value;
  }
}

/** Expected generation seconds for a model (drives the progress ETA). */
export async function expectedSecFor(mcpUrl, token, kind, model) {
  const k = catalogKey(kind);
  try {
    const list = await listModels(mcpUrl, token, kind);
    const found = list.find((m) => m.slug === (model || "auto"));
    if (found?.expectedSec) return found.expectedSec;
  } catch {
    /* ignore */
  }
  return DEFAULT_EXPECTED[k];
}

/**
 * Build the Magnific MCP tool call for a generation request.
 * Returns { tool, args }.
 */
export function buildGenerationCall(kind, { prompt, model, references, libraryRefs, params }) {
  const slug = model && model !== "auto" ? model : undefined;
  const refs = (references ?? []).filter(Boolean);
  // Typed Library references (character/style/locations) — passed as-is for
  // visual consistency. Video only accepts character|product references.
  const lib = (libraryRefs ?? []).filter((r) => r && r.type && (r.identifier || r.creationId));
  // Images accept the library entry identifier as-is.
  const libImageRefs = lib.filter((r) => r.identifier).map((r) => ({ type: r.type, identifier: r.identifier }));
  // Video references of type character/product require a URL (an asset URL or
  // "creation:SQID"), NOT the library identifier — so use the source-image
  // creation as `url`. Refs without a usable creation are dropped (can't be used).
  const libVideoRefs = lib
    .filter((r) => (r.type === "character" || r.type === "product") && (r.url || r.creationId))
    .map((r) => ({
      type: r.type,
      url: r.url ?? (String(r.creationId).startsWith("creation:") ? String(r.creationId) : `creation:${r.creationId}`),
    }));

  if (kind === "image" || kind === "edit") {
    const args = { prompt };
    if (slug) args.mode = slug;
    const ar = params?.aspect_ratio ?? params?.aspectRatio;
    if (ar) args.aspectRatio = ar;
    const imageRefs = [
      ...refs.map((r) => ({ type: "image", identifier: r })),
      ...libImageRefs,
    ];
    if (imageRefs.length) args.references = imageRefs;
    return { tool: "images_generate", args };
  }

  if (kind === "video") {
    const clip = {
      prompt,
      duration: Number(params?.duration ?? params?.videoDurationSec ?? 5),
      aspectRatio: params?.aspect_ratio ?? params?.aspectRatio ?? "16:9",
      resolution: params?.resolution ?? "720p",
    };
    if (slug) clip.slug = slug;
    // The storyboard keyframe can be used as the START FRAME (default) or as an
    // image REFERENCE (e.g. Seedance 2.0, where keyframes.start is incompatible
    // with image refs). The pipeline decides via params.imageRefMode.
    const clipRefs = [...libVideoRefs];
    if (refs[0]) {
      if (params?.imageRefMode === "reference") {
        clipRefs.unshift({ type: "image", url: refs[0] });
      } else {
        clip.keyframes = { start: { type: "image", url: refs[0] } };
      }
    }
    if (clipRefs.length) clip.references = clipRefs;
    return { tool: "video_generate", args: { video: { clips: [clip] } } };
  }

  if (kind === "concat") {
    return {
      tool: "video_concatenate",
      args: { creationIdentifiers: refs, name: "Magnific Studio — entrega" },
    };
  }

  if (kind === "upscale") {
    return { tool: "images_upscale", args: { identifier: refs[0] } };
  }

  if (kind === "audio") {
    // Background music vs. spoken voiceover (TTS), chosen via params.audioType.
    if (params?.audioType === "music") {
      const args = { prompt };
      if (params?.model) args.model = params.model;
      if (params?.durationSeconds) args.durationSeconds = Number(params.durationSeconds);
      if (params?.instrumental != null) args.instrumental = !!params.instrumental;
      return { tool: "audio_music_generate", args };
    }
    const args = { text: prompt };
    if (params?.voiceId != null) args.voiceId = Number(params.voiceId);
    if (params?.model) args.model = params.model;
    return { tool: "audio_tts", args };
  }

  throw new Error(`unsupported generation kind: ${kind}`);
}
