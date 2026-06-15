import type { GenerationKind, GenerationRequest } from "@/types/generation";
import type { Job, PhaseId, Project, Shot } from "@/types/project";
import type { GenerationBlock } from "@/generation/GenerationBlock";
import { config } from "@/config";

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

  const prompt = opts.field === "keyframe" ? shot.keyframePrompt : shot.videoPrompt;
  const model =
    opts.modelOverride ?? (opts.field === "keyframe" ? shot.imageModel : shot.videoModel);

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

  // Visual consistency: every shot references the cast members promoted to the
  // Magnific Library (so the same character looks the same across the short).
  const libraryRefs = project.story.characters
    .filter((c) => c.libraryId)
    .map((c) => ({ type: "character" as const, identifier: c.libraryId! }));

  const req: GenerationRequest = {
    kind: opts.kind,
    prompt,
    model,
    references,
    libraryRefs: libraryRefs.length ? libraryRefs : undefined,
    scopeLabel: opts.scopeLabel,
    preparedForApi: opts.preparedForApi,
    params: Object.keys(params).length ? params : undefined,
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
      { kind: "audio", prompt, model: opts?.model ?? "auto", params },
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
 * After a reload, resume any shot whose job was still "rendering" (it has a
 * backendJobId). The backend sweeper keeps finishing jobs even while the tab is
 * closed; here we poll /mcp-status to pull the finished result into the project.
 */
export function reconcileInflight(api: RunnerApi): void {
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
      api.update((d) => {
        const t = d.audio?.find((x) => x.id === trackId);
        if (!t?.job) return;
        t.job.status = "ready";
        t.job.progress = 100;
        t.job.resultUrl = data.resultUrl;
        t.job.creditsCharged = data.credits;
        t.job.taskId = data.identifier ?? t.job.taskId;
        t.job.updatedAt = Date.now();
        if (data.resultUrl) {
          t.url = data.resultUrl;
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
      api.update((d) => {
        const s = d.shots.find((x) => x.id === shotId);
        const j = s?.[jobField];
        if (!s || !j) return;
        j.status = "ready";
        j.progress = 100;
        j.resultUrl = data.resultUrl;
        j.creditsCharged = data.credits;
        j.taskId = data.identifier ?? j.taskId;
        j.updatedAt = Date.now();
        if (data.resultUrl) {
          (s as Shot)[urlField] = data.resultUrl;
          const hist = s[histField] ?? [];
          if (!hist.includes(data.resultUrl)) hist.push(data.resultUrl);
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
