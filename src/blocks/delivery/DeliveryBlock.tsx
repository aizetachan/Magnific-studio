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

  const assemble = async () => {
    const req = {
      kind: "concat" as const,
      prompt: `Concatenar ${project.scenes.length} escenas validadas`,
      model: "kling-2.1",
      references: project.shots
        .filter((s) => s.approvedVideo && s.videoUrl)
        .map((s) => s.videoUrl!),
    };
    const pre = api.generation.preflight(req);
    api.update((d) => {
      d.delivery.finalVideoJob = {
        id: `concat_${Date.now()}`,
        kind: "concat",
        status: "rendering",
        mode: pre.mode,
        transportLabel: pre.transportLabel,
        progress: 30,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    const result = await api.generation.generate(req);
    api.update((d) => {
      d.delivery.finalVideoJob = {
        id: result.taskId,
        kind: "concat",
        status: result.ok ? "ready" : "failed",
        mode: result.mode,
        transportLabel: result.transportLabel,
        progress: 100,
        resultUrl: result.resultUrl,
        creditsCharged: result.creditsCharged,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (result.ok) d.delivery.finalVideoUrl = result.resultUrl;
      if (d.gates.delivery === "in_progress") d.gates.delivery = "ready";
    });
    if (result.ok) {
      api.meter({
        phase: "delivery",
        scope: "entrega",
        kind: "magnific",
        label: `concat · ${result.transportLabel}`,
        credits: result.creditsCharged,
      });
    }
  };

  const getActions = (): BlockAction[] => [
    {
      id: "assemble_final",
      label: "Ensamblar vídeo final",
      hint: "Concatena las escenas validadas.",
      generative: true,
      enabled: !locked && allScenesValidated,
      run: assemble,
    },
  ];

  return {
    id: "delivery",
    label: "Entrega",
    icon: "📦",
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
