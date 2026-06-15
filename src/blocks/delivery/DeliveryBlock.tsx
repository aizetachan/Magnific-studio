import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { DeliveryPage } from "./DeliveryPage";

/**
 * Delivery block — assembles the final video by concatenating validated scenes,
 * exposes downloads/metadata/total credits, and can explode the project into a
 * Spaces board (§2.5). Studio and Spaces don't compete.
 */
export function buildDeliveryBlock(api: StoreValue): PipelineBlock {
  const { project } = api;
  const locked = project.gates.delivery === "locked";
  const allScenesValidated =
    project.scenes.length > 0 &&
    project.scenes.every((sc) => project.gates.production[sc.id] === "validated");

  // The videos actually produced (with a real Magnific creation identifier),
  // in playback order. video_concatenate needs ≥2 of these identifiers.
  const sceneNum = (sceneId: string) =>
    project.scenes.find((s) => s.id === sceneId)?.number ?? 0;
  const readyVideos = project.shots
    .filter((s) => s.videoJob?.status === "ready" && !!s.videoJob?.taskId)
    .sort(
      (a, b) => sceneNum(a.sceneId) - sceneNum(b.sceneId) || a.order - b.order,
    );
  const canAssemble = !locked && readyVideos.length >= 2;

  const getPageContext = (): PageContext => ({
    phase: "delivery",
    phaseLabel: "Entrega",
    visibleObjects: {
      assembled: !!project.delivery.finalVideoUrl,
      scenes: project.scenes.length,
      allScenesValidated,
    },
    allowedActions: ["assemble_final"],
    blockedActions: [
      "generate_keyframe",
      "vary_keyframe",
      "generate_video",
      "validate_storyboard",
      "validate_scene",
    ],
    implicitReferent: "el ensamblaje final del corto",
  });

  // video_concatenate accepts at most 10 clips, so for more we concat in chunks
  // and then concat the results (hierarchical), keeping playback order.
  const MAX_CONCAT = 10;

  const setFinal = (patch: Partial<NonNullable<typeof project.delivery.finalVideoJob>>) =>
    api.update((d) => {
      d.delivery.finalVideoJob = {
        id: d.delivery.finalVideoJob?.id ?? `concat_${Date.now()}`,
        kind: "concat",
        status: "rendering",
        mode: "mcp_default",
        transportLabel: "McpTransport",
        progress: 5,
        createdAt: d.delivery.finalVideoJob?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        ...d.delivery.finalVideoJob,
        ...patch,
      };
    });

  /** Concat one group (≤10) → returns the resulting creation result. */
  const concatGroup = (ids: string[], note: string) =>
    api.generation.generate(
      { kind: "concat" as const, prompt: note, model: "auto", references: ids },
      ({ progress }) => setFinal({ progress: Math.min(99, progress) }),
    );

  /** Concat any number of clips hierarchically (chunks of ≤10), in order. */
  const concatAll = async (
    ids: string[],
  ): Promise<{ ok: boolean; taskId: string; resultUrl?: string; credits: number; error?: string }> => {
    if (ids.length <= MAX_CONCAT) {
      const r = await concatGroup(ids, `Concatenar ${ids.length} vídeos`);
      return { ok: r.ok, taskId: r.taskId, resultUrl: r.resultUrl, credits: r.creditsCharged, error: r.error };
    }
    const partial: string[] = [];
    let credits = 0;
    for (let i = 0; i < ids.length; i += MAX_CONCAT) {
      const chunk = ids.slice(i, i + MAX_CONCAT);
      if (chunk.length === 1) {
        partial.push(chunk[0]);
        continue;
      }
      const r = await concatGroup(chunk, `Concatenar grupo ${partial.length + 1}`);
      if (!r.ok || !r.taskId) return { ok: false, taskId: "concat", credits, error: r.error };
      partial.push(r.taskId);
      credits += r.creditsCharged;
    }
    const top = await concatAll(partial);
    return { ...top, credits: credits + top.credits };
  };

  const assemble = async () => {
    const ids = readyVideos.map((s) => s.videoJob!.taskId!);
    setFinal({ status: "rendering", progress: 5 });

    const result =
      ids.length === 1
        ? { ok: true, taskId: ids[0], resultUrl: readyVideos[0].videoUrl, credits: 0, error: undefined }
        : await concatAll(ids);

    api.update((d) => {
      const j = d.delivery.finalVideoJob;
      if (j) {
        j.status = result.ok ? "ready" : "failed";
        j.progress = 100;
        j.resultUrl = result.resultUrl;
        j.creditsCharged = result.credits;
        j.error = result.error;
        j.updatedAt = Date.now();
      }
      if (result.ok) d.delivery.finalVideoUrl = result.resultUrl;
      if (result.ok && d.gates.delivery === "in_progress") d.gates.delivery = "ready";
    });
    if (result.ok) {
      api.meter({ phase: "delivery", scope: "entrega", kind: "magnific", label: "concat", credits: result.credits });
    }
  };

  const getActions = (): BlockAction[] => [
    {
      id: "assemble_final",
      label: "Ensamblar vídeo final",
      hint: canAssemble
        ? `Concatena ${readyVideos.length} vídeos en orden.`
        : "Genera al menos 2 vídeos en Producción para poder ensamblar.",
      generative: true,
      enabled: canAssemble,
      run: assemble,
    },
  ];

  return {
    id: "delivery",
    label: "Entrega",
    icon: "",
    getPageContext,
    getActions,
    consume: (_input: BlockInput) => {
      /* receives validated scenes */
    },
    produce: (): BlockOutput => ({
      phase: "delivery",
      payload: { finalVideoUrl: project.delivery.finalVideoUrl },
    }),
    getGateState: () => project.gates.delivery,
    validate: () => {
      api.update((d) => {
        if (d.delivery.finalVideoUrl) d.gates.delivery = "validated";
      });
    },
    render: () => <DeliveryPage />,
  };
}
