import type { GenerationKind, GenerationRequest } from "@/types/generation";
import type { Job, PhaseId, Project, Shot } from "@/types/project";
import type { GenerationBlock } from "@/generation/GenerationBlock";
import { config } from "@/config";
import { materializeAsset, slugify } from "@/state/assets";
import { absDirectorUrl } from "@/generation/transports/McpTransport";
import { characterSheetPrompt, environmentGridPrompt } from "@/director/generate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal slice of the store the runner needs (keeps blocks decoupled). */
export interface RunnerApi {
  project: Project;
  update: (mut: (draft: Project) => void) => void;
  meter: (e: {
    phase: PhaseId | "settings";
    scope: string;
    kind: "claude" | "magnific";
    label: string;
    credits?: number;
  }) => void;
  generation: GenerationBlock;
}

/**
 * Run items with a fixed concurrency (worker pool): keeps `concurrency` items in
 * flight and starts the next as soon as ANY finishes — so one slow/failed item
 * never stalls the whole run. `fn` must not reject (callers swallow errors).
 */
export async function runBatched<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch {
        /* keep the pool going even if one item throws */
      }
    }
  };
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, worker));
}

function jobAt(now: number, partial: Partial<Job>): Job {
  return {
    id: partial.id ?? `job_${now}`,
    kind: partial.kind ?? "image",
    status: partial.status ?? "queued",
    mode: partial.mode ?? "mcp_default",
    transportLabel: partial.transportLabel ?? "—",
    progress: partial.progress ?? 0,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    ...partial,
  };
}

type Field = "keyframe" | "video";

/**
 * Whether a job should block the UI as "in progress". Queued/rendering jobs
 * with no updates for a while are dead (their generate() promise died — e.g.
 * the tab that started them closed), so they must never block regeneration.
 */
export function isJobRunning(job?: Job): boolean {
  if (!job) return false;
  if (job.status !== "queued" && job.status !== "rendering") return false;
  return Date.now() - (job.updatedAt ?? job.createdAt ?? 0) < 3 * 60 * 1000;
}

/**
 * Run a shot generation end to end: preflight -> queued -> rendering -> ready,
 * routed through the dual GenerationBlock, with credits metered on settle.
 * This is the single path both Storyboard (keyframe) and Production (video) use.
 */
export async function runShotGeneration(
  api: RunnerApi,
  opts: {
    shotId: string;
    field: Field;
    kind: GenerationKind;
    phase: PhaseId;
    scopeLabel: string;
    /** Set when Claude has digested & prepared the request for API handoff. */
    preparedForApi?: boolean;
    /** Set when the work must be split across transports (parallel mode). */
    parallel?: boolean;
    /** Override the shot's model (used by batch "Generar todo"). */
    modelOverride?: string;
  },
): Promise<void> {
  const { project, generation } = api;
  const shot = project.shots.find((s) => s.id === opts.shotId);
  if (!shot) return;

  const isKeyframe = opts.field === "keyframe";
  const model =
    opts.modelOverride ?? (isKeyframe ? shot.imageModel : shot.videoModel);

  // Scene-scoped references (visual consistency): the characters + location the
  // scene was assigned, plus the global style. Magnific limits: video_generate
  // only accepts character refs, so location & style enter via the KEYFRAME (the
  // video inherits them through that keyframe). Style is a TEXT definition applied
  // to the keyframe prompt (library_create can't make a "style" asset).
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const lib = project.library ?? [];
  const assetById = (id: string) => lib.find((a) => a.id === id);
  // Effective refs: the shot's override if set, else inherited from its scene.
  const effCharacterIds = shot.characterIds ?? scene?.characterIds ?? [];
  const effLocationId = shot.locationId ?? scene?.locationId;
  const charRefs = effCharacterIds
    .map(assetById)
    .filter((a) => a?.type === "character" && a.magnificIdentifier)
    // creationId = the character's source image creation; video references need a
    // real asset URL (resolved server-side from this), not the library identifier.
    .map((a) => ({ type: "character" as const, identifier: a!.magnificIdentifier!, creationId: a!.creationIds?.[0] }));
  const locAsset = effLocationId ? assetById(effLocationId) : undefined;
  const styleAsset = project.styleId ? assetById(project.styleId) : undefined;

  let prompt = isKeyframe ? shot.keyframePrompt : shot.videoPrompt;
  if (isKeyframe && styleAsset?.prompt?.trim()) {
    prompt = `${prompt}\n\nVisual style (apply consistently): ${styleAsset.prompt.trim()}`;
  }

  const libraryRefs: Array<{ type: "character" | "locations" | "style"; identifier: string; creationId?: string }> = [
    ...charRefs,
  ];
  // Location only on the keyframe (image) — video can't take a location ref.
  if (isKeyframe && locAsset?.type === "location" && locAsset.magnificIdentifier) {
    libraryRefs.push({ type: "locations", identifier: locAsset.magnificIdentifier });
  }
  // Global style: when active AND registered in the Magnific Library as a
  // style entry, reference it so the look stays consistent across the whole
  // production (in addition to the style TEXT injected into the prompt).
  if (isKeyframe && styleAsset?.type === "style" && styleAsset.magnificIdentifier) {
    libraryRefs.push({ type: "style", identifier: styleAsset.magnificIdentifier });
  }

  // Video uses the storyboard keyframe as its start frame — pass the keyframe's
  // Magnific creation identifier (Magnific can't reach our local file URL).
  const references =
    opts.field === "video" && shot.keyframeJob?.taskId
      ? [shot.keyframeJob.taskId]
      : undefined;

  const params: Record<string, unknown> = {};
  if (opts.field === "video") {
    params.duration = shot.videoDurationSec;
    // The user's explicit choice (only shown for ref-capable models). When unset,
    // the backend decides by model capability and falls back if the model rejects it.
    if (shot.videoRefMode) params.imageRefMode = shot.videoRefMode;
  }
  if (opts.parallel) params.parallel = true;

  const req: GenerationRequest = {
    kind: opts.kind,
    prompt,
    model,
    references,
    libraryRefs: libraryRefs.length ? libraryRefs : undefined,
    scopeLabel: opts.scopeLabel,
    preparedForApi: opts.preparedForApi,
    params: Object.keys(params).length ? params : undefined,
    // Human-readable local filename: "mi-corto_escena-2-plano-3_keyframe_..."
    assetHint: `${slugify(opts.scopeLabel)}_${opts.field}`,
  };

  const preflight = generation.preflight(req);
  const jobField = opts.field === "keyframe" ? "keyframeJob" : "videoJob";
  const urlField = opts.field === "keyframe" ? "keyframeUrl" : "videoUrl";
  const now = Date.now();

  // queued
  api.update((d) => {
    const s = d.shots.find((x) => x.id === opts.shotId)!;
    s[jobField] = jobAt(now, {
      kind: opts.kind,
      status: "queued",
      mode: preflight.mode,
      transportLabel: preflight.transportLabel,
      progress: 5,
    });
  });

  try {
    // Live progress: the transport polls the async Magnific job and reports back.
    const result = await generation.generate(req, ({ progress, status, jobId }) => {
      api.update((d) => {
        const s = d.shots.find((x) => x.id === opts.shotId)!;
        const j = s[jobField];
        if (!j || j.status === "ready" || j.status === "failed") return;
        if (jobId) j.backendJobId = jobId; // persisted → resume after reload
        j.status = status === "ready" ? "rendering" : status; // settle below
        j.progress = Math.max(j.progress, Math.min(99, progress));
        j.updatedAt = Date.now();
      });
    });
    api.update((d) => {
      const s = d.shots.find((x) => x.id === opts.shotId)!;
      s[jobField] = jobAt(now, {
        kind: opts.kind,
        status: result.ok ? "ready" : "failed",
        mode: result.mode,
        transportLabel: result.transportLabel,
        progress: 100,
        resultUrl: result.resultUrl,
        creditsCharged: result.creditsCharged,
        taskId: result.taskId,
        error: result.error,
      });
      if (result.ok && result.resultUrl) {
        (s as Shot)[urlField] = result.resultUrl;
        // Keep every generation in history so the user can flip back to one.
        const histField = opts.field === "keyframe" ? "keyframeHistory" : "videoHistory";
        const hist = s[histField] ?? [];
        if (!hist.includes(result.resultUrl)) hist.push(result.resultUrl);
        s[histField] = hist;
        // Reflect the model Magnific actually used (so the selector shows it).
        if (result.model) {
          if (opts.field === "keyframe") s.imageModel = result.model;
          else s.videoModel = result.model;
        }
        // A fresh render invalidates a prior approval at this stage.
        if (opts.field === "keyframe") s.approvedKeyframe = false;
        else s.approvedVideo = false;
      }
    });
    if (result.ok) {
      api.meter({
        phase: opts.phase,
        scope: opts.scopeLabel,
        kind: "magnific",
        label: opts.kind,
        credits: result.creditsCharged,
      });
    }
  } catch (err) {
    api.update((d) => {
      const s = d.shots.find((x) => x.id === opts.shotId)!;
      const j = s[jobField];
      if (j) {
        j.status = "failed";
        j.error = err instanceof Error ? err.message : String(err);
        j.updatedAt = Date.now();
      }
    });
  }
}

/**
 * Generate one audio track (scene voiceover or background music) through the same
 * async backend job machinery as image/video, storing the result on the track.
 */
export async function runAudio(
  api: RunnerApi,
  trackId: string,
  opts?: {
    voiceId?: number;
    model?: string;
    durationSeconds?: number;
    instrumental?: boolean;
    // Fallbacks used when the track was just created (the api.project snapshot
    // captured in the caller's render may not include it yet).
    prompt?: string;
    kind?: "voice" | "music";
    label?: string;
  },
): Promise<void> {
  const { project, generation } = api;
  const track = project.audio?.find((t) => t.id === trackId);
  const kind = track?.kind ?? opts?.kind ?? "music";
  const prompt = (track?.prompt ?? opts?.prompt ?? "").trim();
  const label = track?.label ?? opts?.label ?? (kind === "music" ? "Música" : "Voz");
  if (!prompt) return;
  const now = Date.now();

  const params: Record<string, unknown> = { audioType: kind };
  if (kind === "voice" && opts?.voiceId != null) params.voiceId = opts.voiceId;
  if (kind === "music" && opts?.durationSeconds) params.durationSeconds = opts.durationSeconds;
  if (kind === "music" && opts?.instrumental != null) params.instrumental = opts.instrumental;
  if (opts?.model) params.model = opts.model;

  api.update((d) => {
    const t = d.audio?.find((x) => x.id === trackId);
    if (t)
      t.job = jobAt(now, { kind: "audio", status: "queued", mode: "mcp_default", transportLabel: "McpTransport", progress: 5 });
  });

  try {
    const result = await generation.generate(
      {
        kind: "audio",
        prompt,
        model: opts?.model ?? "auto",
        params,
        assetHint: `audio_${slugify(label)}`,
      },
      ({ progress, status, jobId }) => {
        api.update((d) => {
          const j = d.audio?.find((x) => x.id === trackId)?.job;
          if (!j || j.status === "ready" || j.status === "failed") return;
          if (jobId) j.backendJobId = jobId;
          j.status = status === "ready" ? "rendering" : status;
          j.progress = Math.max(j.progress, Math.min(99, progress));
          j.updatedAt = Date.now();
        });
      },
    );
    api.update((d) => {
      const t = d.audio?.find((x) => x.id === trackId);
      if (!t) return;
      t.job = jobAt(now, {
        kind: "audio",
        status: result.ok ? "ready" : "failed",
        mode: result.mode,
        transportLabel: result.transportLabel,
        progress: 100,
        resultUrl: result.resultUrl,
        creditsCharged: result.creditsCharged,
        taskId: result.taskId,
        error: result.error,
      });
      if (result.ok && result.resultUrl) {
        t.url = result.resultUrl;
        t.credits = result.creditsCharged;
      }
    });
    if (result.ok) {
      api.meter({
        phase: "delivery",
        scope: label,
        kind: "magnific",
        label: kind === "music" ? "música" : "voz",
        credits: result.creditsCharged,
      });
    }
  } catch (err) {
    api.update((d) => {
      const j = d.audio?.find((x) => x.id === trackId)?.job;
      if (j) {
        j.status = "failed";
        j.error = err instanceof Error ? err.message : String(err);
        j.updatedAt = Date.now();
      }
    });
  }
}

/**
 * Generate the preview image for one Library asset (character/location) applying
 * the global visual style, then auto-save it to the Magnific Library so it
 * becomes a reusable reference. Mutates the asset (thumbnail + magnificIdentifier).
 */
async function generateOneAssetPreview(api: RunnerApi, assetId: string, styleText?: string): Promise<void> {
  const asset = api.project.library?.find((a) => a.id === assetId);
  if (!asset?.prompt) return;
  const now = Date.now();
  const prompt = styleText ? `${asset.prompt}\n\nVisual style (apply consistently): ${styleText}` : asset.prompt;

  api.update((d) => {
    const a = d.library?.find((x) => x.id === assetId);
    if (a) a.job = jobAt(now, { kind: "image", status: "queued", mode: "mcp_default", transportLabel: "McpTransport", progress: 5 });
  });

  let result;
  try {
    result = await api.generation.generate({ kind: "image", prompt, model: "auto", assetHint: `biblioteca_${slugify(asset.name)}_sheet` }, ({ progress, status, jobId }) => {
      api.update((d) => {
        const j = d.library?.find((x) => x.id === assetId)?.job;
        if (!j || j.status === "ready" || j.status === "failed") return;
        if (jobId) j.backendJobId = jobId; // persisted → resume after reload
        j.status = status === "ready" ? "rendering" : status;
        j.progress = Math.max(j.progress, Math.min(99, progress));
        j.updatedAt = Date.now();
      });
    });
  } catch (e) {
    api.update((d) => {
      const a = d.library?.find((x) => x.id === assetId);
      if (a) a.job = jobAt(now, { kind: "image", status: "failed", error: e instanceof Error ? e.message : String(e) });
    });
    return;
  }

  api.update((d) => {
    const a = d.library?.find((x) => x.id === assetId);
    if (!a) return;
    a.job = jobAt(now, { kind: "image", status: result!.ok ? "ready" : "failed", progress: 100, resultUrl: result!.resultUrl, taskId: result!.taskId, error: result!.error });
    if (result!.ok && result!.resultUrl) {
      // Cover image. Reset the reference set to this single image.
      a.thumbnailUrl = result!.resultUrl;
      a.images = [result!.resultUrl];
      a.creationIds = result!.taskId ? [result!.taskId] : [];
    }
  });

  if (result.ok && (asset.type === "character" || asset.type === "location")) {
    await saveAssetToLibrary(api, assetId);
  }
}

/**
 * (Re)create the Magnific Library entry for an asset from ALL its reference
 * images (cover + character sheet / environment grid views, up to 6) and store
 * the resulting library identifier. Richer references → better consistency.
 */
async function saveAssetToLibrary(api: RunnerApi, assetId: string): Promise<void> {
  const asset = api.project.library?.find((a) => a.id === assetId);
  if (!asset || (asset.type !== "character" && asset.type !== "location")) return;
  const ids = (asset.creationIds ?? []).filter(Boolean).slice(0, 6);
  if (ids.length === 0) return;
  try {
    const res = await fetch(`${config.directorBase}/library-create`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: asset.name,
        type: asset.type === "location" ? "locations" : "character",
        description: asset.description || undefined,
        images: ids.map((creationIdentifier) => ({ creationIdentifier })),
      }),
    });
    const data = (await res.json()) as { ok: boolean; identifier?: string };
    if (data.ok && data.identifier) {
      api.update((d) => {
        const a = d.library?.find((x) => x.id === assetId);
        if (a) a.magnificIdentifier = String(data.identifier);
      });
    }
  } catch {
    /* keep the local images even if saving the library ref fails */
  }
}

/**
 * Generate a CHARACTER SHEET (multiple views/expressions) or an ENVIRONMENT 3×3
 * GRID (viewpoints) as an extra reference image, applying the global style, and
 * re-save the library entry so the asset carries richer references.
 */
export async function generateAssetSheet(api: RunnerApi, assetId: string): Promise<void> {
  const asset = api.project.library?.find((a) => a.id === assetId);
  if (!asset || (asset.type !== "character" && asset.type !== "location")) return;
  const lib = api.project.library ?? [];
  const styleText = api.project.styleId ? lib.find((a) => a.id === api.project.styleId)?.prompt?.trim() : undefined;
  const base =
    asset.type === "character"
      ? characterSheetPrompt(asset.name, asset.description ?? "")
      : environmentGridPrompt(asset.name, asset.description ?? "");
  const prompt = styleText ? `${base}\n\nVisual style (apply consistently): ${styleText}` : base;
  const now = Date.now();

  api.update((d) => {
    const a = d.library?.find((x) => x.id === assetId);
    if (a) a.sheetJob = jobAt(now, { kind: "image", status: "queued", mode: "mcp_default", transportLabel: "McpTransport", progress: 5 });
  });

  let result;
  try {
    result = await api.generation.generate({ kind: "image", prompt, model: "auto", assetHint: `biblioteca_${slugify(asset.name)}_sheet` }, ({ progress, status, jobId }) => {
      api.update((d) => {
        const j = d.library?.find((x) => x.id === assetId)?.sheetJob;
        if (!j || j.status === "ready" || j.status === "failed") return;
        if (jobId) j.backendJobId = jobId; // persisted → resume after reload
        j.status = status === "ready" ? "rendering" : status;
        j.progress = Math.max(j.progress, Math.min(99, progress));
        j.updatedAt = Date.now();
      });
    });
  } catch (e) {
    api.update((d) => {
      const a = d.library?.find((x) => x.id === assetId);
      if (a) a.sheetJob = jobAt(now, { kind: "image", status: "failed", error: e instanceof Error ? e.message : String(e) });
    });
    return;
  }

  api.update((d) => {
    const a = d.library?.find((x) => x.id === assetId);
    if (!a) return;
    a.sheetJob = jobAt(now, { kind: "image", status: result!.ok ? "ready" : "failed", progress: 100, resultUrl: result!.resultUrl, taskId: result!.taskId, error: result!.error });
    if (result!.ok && result!.resultUrl) {
      a.images = [...(a.images ?? []), result!.resultUrl];
      if (result!.taskId) a.creationIds = [...(a.creationIds ?? []), result!.taskId];
    }
  });

  if (result.ok) await saveAssetToLibrary(api, assetId);
}

/** Generate (or regenerate) the preview of a single asset, applying the style. */
export async function generateAssetPreview(api: RunnerApi, assetId: string): Promise<void> {
  const lib = api.project.library ?? [];
  const styleText = api.project.styleId
    ? lib.find((a) => a.id === api.project.styleId)?.prompt?.trim()
    : undefined;
  await generateOneAssetPreview(api, assetId, styleText);
}

/**
 * Generate previews for all character/location assets that don't have an image
 * yet, applying the global style for visual consistency. Auto-saves each to the
 * Magnific Library. Used by Historia after developing the story.
 */
export async function generateAssetPreviews(
  api: RunnerApi,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const lib = api.project.library ?? [];
  const styleText = api.project.styleId
    ? lib.find((a) => a.id === api.project.styleId)?.prompt?.trim()
    : undefined;
  const targets = lib.filter(
    (a) => (a.type === "character" || a.type === "location") && !a.thumbnailUrl,
  );
  let done = 0;
  onProgress?.(done, targets.length);
  await runBatched(targets, 3, async (asset) => {
    await generateOneAssetPreview(api, asset.id, styleText);
    done += 1;
    onProgress?.(done, targets.length);
  });
}

/**
 * After a reload, resume any shot whose job was still "rendering" (it has a
 * backendJobId). The backend sweeper keeps finishing jobs even while the tab is
 * closed; here we poll /mcp-status to pull the finished result into the project.
 */
export function reconcileInflight(api: RunnerApi): void {
  // A job that reached persistence while "queued"/"rendering" WITHOUT a backend
  // id can never resume (its generate() promise died with the old tab) — mark it
  // failed so the UI never stays stuck on "En cola" and regenerating is obvious.
  const failStale = (j?: Job): void => {
    if (!j) return;
    if (j.status !== "queued" && j.status !== "rendering") return;
    if (j.status === "rendering" && j.backendJobId) return; // resumable below
    j.status = "failed";
    j.error = "Generación interrumpida (se cerró la app). Vuelve a generar.";
    j.updatedAt = Date.now();
  };
  api.update((d) => {
    for (const s of d.shots) {
      failStale(s.keyframeJob);
      failStale(s.videoJob);
    }
    for (const tr of d.audio ?? []) failStale(tr.job);
    for (const a of d.library ?? []) {
      failStale(a.job);
      failStale(a.sheetJob);
    }
  });

  for (const shot of api.project.shots) {
    if (shot.keyframeJob?.status === "rendering" && shot.keyframeJob.backendJobId) {
      void resumePoll(api, shot.id, "keyframe", shot.keyframeJob.backendJobId);
    }
    if (shot.videoJob?.status === "rendering" && shot.videoJob.backendJobId) {
      void resumePoll(api, shot.id, "video", shot.videoJob.backendJobId);
    }
  }
  for (const tr of api.project.audio ?? []) {
    if (tr.job?.status === "rendering" && tr.job.backendJobId) {
      void resumePollAudio(api, tr.id, tr.job.backendJobId);
    }
  }
  for (const a of api.project.library ?? []) {
    if (a.job?.status === "rendering" && a.job.backendJobId) {
      void resumePollAsset(api, a.id, "job", a.job.backendJobId);
    }
    if (a.sheetJob?.status === "rendering" && a.sheetJob.backendJobId) {
      void resumePollAsset(api, a.id, "sheetJob", a.sheetJob.backendJobId);
    }
  }
}

/**
 * Resume an in-flight Library asset image after reload (casting previews and
 * character sheets). On success it applies the same mutations as the original
 * flow: preview → reset the reference set to the new cover; sheet → append.
 */
async function resumePollAsset(
  api: RunnerApi,
  assetId: string,
  field: "job" | "sheetJob",
  backendJobId: string,
): Promise<void> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    let data: { status?: string; progress?: number; resultUrl?: string; identifier?: string; error?: string };
    try {
      const res = await fetch(`${config.directorBase}/mcp-status?job=${encodeURIComponent(backendJobId)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        await sleep(2500);
        continue;
      }
      data = await res.json();
    } catch {
      await sleep(2500);
      continue;
    }
    if (data.status === "ready") {
      // Local-first: store the bytes on the user's machine, use the blob: URL.
      const rAsset = api.project.library?.find((x) => x.id === assetId);
      const hint = `biblioteca_${slugify(rAsset?.name ?? "asset")}_${backendJobId.slice(-6)}`;
      const localUrl = data.resultUrl
        ? await materializeAsset(hint, absDirectorUrl(data.resultUrl))
        : undefined;
      api.update((d) => {
        const a = d.library?.find((x) => x.id === assetId);
        const j = a?.[field];
        if (!a || !j) return;
        j.status = "ready";
        j.progress = 100;
        j.resultUrl = localUrl;
        j.taskId = data.identifier ?? j.taskId;
        j.updatedAt = Date.now();
        if (!localUrl) return;
        if (field === "job") {
          // Cover image. Reset the reference set to this single image.
          a.thumbnailUrl = localUrl;
          a.images = [localUrl];
          a.creationIds = data.identifier ? [data.identifier] : [];
        } else {
          a.images = [...(a.images ?? []), localUrl];
          if (data.identifier) a.creationIds = [...(a.creationIds ?? []), data.identifier];
        }
      });
      const asset = api.project.library?.find((x) => x.id === assetId);
      if (asset && (asset.type === "character" || asset.type === "location")) {
        await saveAssetToLibrary(api, assetId);
      }
      return;
    }
    if (data.status === "failed") {
      api.update((d) => {
        const j = d.library?.find((x) => x.id === assetId)?.[field];
        if (j) {
          j.status = "failed";
          j.error = data.error;
          j.updatedAt = Date.now();
        }
      });
      return;
    }
    api.update((d) => {
      const j = d.library?.find((x) => x.id === assetId)?.[field];
      if (j && j.status === "rendering") j.progress = Math.max(j.progress, Math.min(99, data.progress ?? 10));
    });
    await sleep(2500);
  }
}

/** Resume an in-flight audio track after reload (mirror of resumePoll for shots). */
async function resumePollAudio(api: RunnerApi, trackId: string, backendJobId: string): Promise<void> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    let data: { status?: string; progress?: number; resultUrl?: string; identifier?: string; credits?: number };
    try {
      const res = await fetch(`${config.directorBase}/mcp-status?job=${encodeURIComponent(backendJobId)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        await sleep(2500);
        continue;
      }
      data = await res.json();
    } catch {
      await sleep(2500);
      continue;
    }
    if (data.status === "ready") {
      // Local-first: store the bytes on the user's machine, use the blob: URL.
      const rTrack = api.project.audio?.find((x) => x.id === trackId);
      const hint = `audio_${slugify(rTrack?.label ?? "pista")}_${backendJobId.slice(-6)}`;
      const localUrl = data.resultUrl
        ? await materializeAsset(hint, absDirectorUrl(data.resultUrl))
        : undefined;
      api.update((d) => {
        const t = d.audio?.find((x) => x.id === trackId);
        if (!t?.job) return;
        t.job.status = "ready";
        t.job.progress = 100;
        t.job.resultUrl = localUrl;
        t.job.creditsCharged = data.credits;
        t.job.taskId = data.identifier ?? t.job.taskId;
        t.job.updatedAt = Date.now();
        if (localUrl) {
          t.url = localUrl;
          t.credits = data.credits;
        }
      });
      return;
    }
    if (data.status === "failed") {
      api.update((d) => {
        const j = d.audio?.find((x) => x.id === trackId)?.job;
        if (j) {
          j.status = "failed";
          j.updatedAt = Date.now();
        }
      });
      return;
    }
    api.update((d) => {
      const j = d.audio?.find((x) => x.id === trackId)?.job;
      if (j && j.status === "rendering") j.progress = Math.max(j.progress, Math.min(99, data.progress ?? 10));
    });
    await sleep(2500);
  }
}

async function resumePoll(
  api: RunnerApi,
  shotId: string,
  field: Field,
  backendJobId: string,
): Promise<void> {
  const jobField = field === "keyframe" ? "keyframeJob" : "videoJob";
  const urlField = field === "keyframe" ? "keyframeUrl" : "videoUrl";
  const histField = field === "keyframe" ? "keyframeHistory" : "videoHistory";
  const modelField = field === "keyframe" ? "imageModel" : "videoModel";
  const deadline = Date.now() + 20 * 60 * 1000;

  while (Date.now() < deadline) {
    let data: {
      status?: string;
      progress?: number;
      resultUrl?: string;
      identifier?: string;
      credits?: number;
      model?: string;
      error?: string;
    };
    try {
      const res = await fetch(
        `${config.directorBase}/mcp-status?job=${encodeURIComponent(backendJobId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        await sleep(2500);
        continue;
      }
      data = await res.json();
    } catch {
      await sleep(2500);
      continue;
    }

    if (data.status === "ready") {
      // Local-first: store the bytes on the user's machine, use the blob: URL.
      const proj = api.project;
      const rShot = proj.shots.find((x) => x.id === shotId);
      const rScene = proj.scenes.find((x) => x.id === rShot?.sceneId);
      const hint = `escena-${rScene?.number ?? "x"}-plano-${rShot?.order ?? "x"}_${field}_${backendJobId.slice(-6)}`;
      const localUrl = data.resultUrl
        ? await materializeAsset(hint, absDirectorUrl(data.resultUrl))
        : undefined;
      api.update((d) => {
        const s = d.shots.find((x) => x.id === shotId);
        const j = s?.[jobField];
        if (!s || !j) return;
        j.status = "ready";
        j.progress = 100;
        j.resultUrl = localUrl;
        j.creditsCharged = data.credits;
        j.taskId = data.identifier ?? j.taskId;
        j.updatedAt = Date.now();
        if (localUrl) {
          (s as Shot)[urlField] = localUrl;
          const hist = s[histField] ?? [];
          if (!hist.includes(localUrl)) hist.push(localUrl);
          s[histField] = hist;
          if (data.model) (s as Shot)[modelField] = data.model;
        }
      });
      return;
    }
    if (data.status === "failed") {
      api.update((d) => {
        const j = d.shots.find((x) => x.id === shotId)?.[jobField];
        if (j) {
          j.status = "failed";
          j.error = data.error;
          j.updatedAt = Date.now();
        }
      });
      return;
    }
    api.update((d) => {
      const j = d.shots.find((x) => x.id === shotId)?.[jobField];
      if (j && j.status === "rendering") {
        j.progress = Math.max(j.progress, Math.min(99, data.progress ?? 10));
      }
    });
    await sleep(2500);
  }
}
