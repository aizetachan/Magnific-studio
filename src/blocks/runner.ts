import type { GenerationKind, GenerationRequest } from "@/types/generation";
import type { Job, PhaseId, Project, Shot } from "@/types/project";
import type { GenerationBlock } from "@/generation/GenerationBlock";

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
  },
): Promise<void> {
  const { project, generation } = api;
  const shot = project.shots.find((s) => s.id === opts.shotId);
  if (!shot) return;

  const prompt = opts.field === "keyframe" ? shot.keyframePrompt : shot.videoPrompt;
  const model = opts.field === "keyframe" ? shot.imageModel : shot.videoModel;

  const req: GenerationRequest = {
    kind: opts.kind,
    prompt,
    model,
    scopeLabel: opts.scopeLabel,
    preparedForApi: opts.preparedForApi,
    params: opts.parallel ? { parallel: true } : undefined,
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

  // rendering (let the UI show the queue transition)
  await new Promise((r) => setTimeout(r, 120));
  api.update((d) => {
    const s = d.shots.find((x) => x.id === opts.shotId)!;
    const j = s[jobField];
    if (j) {
      j.status = "rendering";
      j.progress = 40;
      j.updatedAt = Date.now();
    }
  });

  try {
    const result = await generation.generate(req);
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
        label: `${opts.kind} · ${result.transportLabel} (${result.mode})`,
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
