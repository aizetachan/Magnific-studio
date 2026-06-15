/**
 * Model catalog for the UI selector.
 *
 * Source of truth is the live Magnific catalog, served by the Director at
 * /api/director/models (images_models_list / video_models_list). We keep a real
 * static fallback so the selector works before connecting / offline, and cache
 * per kind for the session.
 */

import { useEffect, useState } from "react";
import { config } from "@/config";
import type { GenerationKind } from "@/types/generation";

export interface ModelOption {
  slug: string;
  name: string;
  expectedSec?: number;
  recommended?: boolean;
  /** Can take an image as a content reference (not just as the start frame). */
  imageRef?: boolean;
}

type CatalogKind = "image" | "video";

const STATIC: Record<CatalogKind, ModelOption[]> = {
  image: [
    { slug: "auto", name: "Auto (Magnific elige)" },
    { slug: "recraft-v4-1", name: "Recraft V4.1", recommended: true },
    { slug: "imagen-nano-banana-2", name: "Nano Banana Pro", recommended: true },
    { slug: "imagen-nano-banana-2-flash", name: "Nano Banana 2 (rápido)" },
    { slug: "gpt-2", name: "GPT 2" },
  ],
  video: [
    { slug: "auto", name: "Auto (Magnific elige)", imageRef: true },
    { slug: "bytedance-seedance-pro-2.0", name: "Seedance 2.0", recommended: true, imageRef: true },
    { slug: "kling-25", name: "Kling 2.5", imageRef: false },
    { slug: "bytedance-seedance-fast-2.0", name: "Seedance 2.0 Fast", imageRef: true },
  ],
};

const cache: Partial<Record<CatalogKind, ModelOption[]>> = {};

function catalogKind(kind: GenerationKind): CatalogKind {
  return kind === "video" ? "video" : "image";
}

/** Drop vendor prefixes from display names (e.g. "Google Nano Banana" → "Nano Banana"). */
function cleanName(name: string): string {
  return name.replace(/^(google|bytedance|byte dance|openai|stability ai|black forest labs)\s+/i, "").trim();
}

export async function fetchModels(kind: GenerationKind): Promise<ModelOption[]> {
  const k = catalogKind(kind);
  if (cache[k]) return cache[k]!;
  try {
    const res = await fetch(`${config.directorBase}/models?kind=${k}`);
    if (res.ok) {
      const data = (await res.json()) as { models?: ModelOption[] };
      if (data?.models?.length) {
        const cleaned = data.models.map((m) => ({ ...m, name: cleanName(m.name) }));
        cache[k] = cleaned;
        return cleaned;
      }
    }
  } catch {
    /* fall back to static */
  }
  cache[k] = STATIC[k];
  return STATIC[k];
}

/** Reactive model list for the given kind (live catalog, static fallback). */
export function useModels(kind: GenerationKind): ModelOption[] {
  const k = catalogKind(kind);
  const [models, setModels] = useState<ModelOption[]>(cache[k] ?? STATIC[k]);
  useEffect(() => {
    let alive = true;
    fetchModels(kind).then((m) => {
      if (alive) setModels(m);
    });
    return () => {
      alive = false;
    };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return models;
}

export function modelLabel(models: ModelOption[], slug: string): string {
  return models.find((m) => m.slug === slug)?.name ?? slug;
}

/** Whether this model can use the keyframe as a content reference. */
export function modelSupportsRef(models: ModelOption[], slug: string): boolean {
  if (slug === "auto") return true; // Magnific's auto routes to a ref-capable model
  return !!models.find((m) => m.slug === slug)?.imageRef;
}

/** Pick a different model to retry with (prefer a recommended one ≠ current). */
export function alternativeModel(models: ModelOption[], current: string): string {
  const real = models.filter((m) => m.slug !== "auto" && m.slug !== current);
  if (real.length === 0) return "auto";
  return (real.find((m) => m.recommended) ?? real[0]).slug;
}

/** Expected generation time (s) for a model ("auto" → recommended). */
export function expectedSecFor(kind: GenerationKind, slug: string): number {
  const k = catalogKind(kind);
  const list = cache[k] ?? STATIC[k];
  const m =
    (slug && slug !== "auto" ? list.find((x) => x.slug === slug) : undefined) ??
    list.find((x) => x.recommended) ??
    list.find((x) => x.slug !== "auto");
  return m?.expectedSec ?? (k === "video" ? 300 : 40);
}

// Magnific doesn't quote price upfront, but cost correlates with compute time
// (e.g. recraft image ~13s ≈ 60 credits). We estimate from the model's expected
// generation time so the figure DIFFERS per model and updates on change.
const CREDITS_PER_SEC = 4.6;

/** Estimated credits for one generation with a given model ("auto" → recommended). */
export function estCreditsFor(kind: GenerationKind, slug: string): number {
  const k = catalogKind(kind);
  const list = cache[k] ?? STATIC[k];
  const m =
    (slug && slug !== "auto" ? list.find((x) => x.slug === slug) : undefined) ??
    list.find((x) => x.recommended) ??
    list.find((x) => x.slug !== "auto");
  const sec = m?.expectedSec ?? (k === "video" ? 300 : 40);
  return Math.round(sec * CREDITS_PER_SEC);
}
