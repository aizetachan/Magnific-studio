import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { GateState } from "@/types/project";
import type { StoreValue } from "@/state/ProjectStore";
import { runShotGeneration } from "../runner";
import { ProductionPage } from "./ProductionPage";

/**
 * Production block — double hierarchy (Master de escenas + Workspace de escena).
 * Claude's scope = the ACTIVE scene: "el plano 2" means plano 2 of THIS scene,
 * not plano 2 of the short (§2.4, §4). Credits burn here, so validation is
 * per-scene.
 */
export function buildProductionBlock(api: StoreValue): PipelineBlock {
  const { project, activeSceneId } = api;
  const locked = project.gates.storyboard !== "validated";

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ??
    [...project.scenes].sort((a, b) => a.number - b.number)[0];

  const sceneShots = (sceneId: string) =>
    project.shots
      .filter((s) => s.sceneId === sceneId)
      .sort((a, b) => a.order - b.order);

  const activeShots = activeScene ? sceneShots(activeScene.id) : [];

  const getPageContext = (): PageContext => ({
    phase: "production",
    phaseLabel: activeScene
      ? `Producción → Escena ${activeScene.number}`
      : "Producción",
    visibleObjects: {
      activeSceneId: activeScene?.id ?? null,
      activeSceneNumber: activeScene?.number ?? null,
      // ONLY this scene's shots are visible -> implicit "plano N" resolves here.
      shots: activeShots.map((s) => ({
        id: s.id,
        order: s.order,
        approved: s.approvedVideo,
      })),
    },
    allowedActions: ["generate_video", "validate_scene"],
    blockedActions: [
      "generate_keyframe",
      "vary_keyframe",
      "validate_storyboard",
      "assemble_final",
    ],
    implicitReferent: activeScene
      ? `los planos de la Escena ${activeScene.number}`
      : "los planos de la escena activa",
  });

  const scopeOf = (shotId: string) => {
    const shot = project.shots.find((s) => s.id === shotId);
    const sc = project.scenes.find((s) => s.id === shot?.sceneId);
    return `Escena ${sc?.number ?? "?"} · Plano ${shot?.order ?? "?"}`;
  };

  const getActions = (): BlockAction[] => [
    {
      id: "generate_video",
      label: "Producir vídeo de la escena",
      hint: "Encola los planos de la escena activa (scope = esta escena).",
      generative: true,
      enabled: !locked && !!activeScene,
      run: async (arg) => {
        // Implicit referent: a specific shot of THIS scene, or all of them.
        const targets =
          arg?.shotId && activeShots.some((s) => s.id === arg.shotId)
            ? [arg.shotId]
            : activeShots.map((s) => s.id);
        for (const id of targets) {
          await runShotGeneration(api, {
            shotId: id,
            field: "video",
            kind: "video",
            phase: "production",
            scopeLabel: scopeOf(id),
          });
        }
      },
    },
    {
      id: "validate_scene",
      label: "Escena validada",
      hint: "Aprueba la escena activa (mini-gate).",
      enabled:
        !!activeScene &&
        activeShots.length > 0 &&
        activeShots.every((s) => s.approvedVideo),
      run: () => productionBlock.validate(),
    },
  ];

  // Aggregate gate for the sidebar.
  const aggregateGate = (): GateState => {
    if (locked) return "locked";
    const scenes = project.scenes;
    if (scenes.length === 0) return "in_progress";
    const allValidated = scenes.every(
      (sc) => project.gates.production[sc.id] === "validated",
    );
    return allValidated ? "validated" : "in_progress";
  };

  const productionBlock: PipelineBlock = {
    id: "production",
    label: "Producción",
    icon: "",
    getPageContext,
    getActions,
    consume: (_input: BlockInput) => {
      /* receives validated storyboard (approved keyframes) */
    },
    produce: (): BlockOutput => ({
      phase: "production",
      payload: {
        validatedScenes: project.scenes
          .filter((sc) => project.gates.production[sc.id] === "validated")
          .map((sc) => sc.id),
      },
    }),
    getGateState: aggregateGate,
    // Validates the ACTIVE scene (per-scene mini-gate).
    validate: () => {
      if (!activeScene) return;
      api.update((d) => {
        const shots = d.shots.filter((s) => s.sceneId === activeScene.id);
        if (shots.length > 0 && shots.every((s) => s.approvedVideo)) {
          d.gates.production[activeScene.id] = "validated";
        }
        // When all scenes validated, open delivery for assembly.
        const allValidated = d.scenes.every(
          (sc) => d.gates.production[sc.id] === "validated",
        );
        if (allValidated && d.gates.delivery === "locked") {
          d.gates.delivery = "in_progress";
        }
      });
    },
    render: () => <ProductionPage />,
  };

  return productionBlock;
}
