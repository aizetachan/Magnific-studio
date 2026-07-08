import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { runShotGeneration } from "../runner";
import { StoryboardPage } from "./StoryboardPage";

/**
 * Storyboard block — iterates keyframes of the WHOLE short (the plan). Validates
 * the set. No final video here (§2.3). Implicit "plano N" = the Nth card.
 */
export function buildStoryboardBlock(api: StoreValue): PipelineBlock {
  const { project } = api;
  const locked = project.gates.storyboard === "locked";

  const sceneNumberOf = (sceneId: string) =>
    project.scenes.find((s) => s.id === sceneId)?.number ?? 0;

  // Global ordering for the flat grid (group by scene, then shot order).
  const ordered = [...project.shots].sort(
    (a, b) =>
      sceneNumberOf(a.sceneId) - sceneNumberOf(b.sceneId) || a.order - b.order,
  );

  const allApproved =
    ordered.length > 0 && ordered.every((s) => s.approvedKeyframe);

  const getPageContext = (): PageContext => ({
    phase: "storyboard",
    phaseLabel: "Storyboard",
    visibleObjects: {
      shots: ordered.map((s, i) => ({
        id: s.id,
        order: i + 1,
        approved: s.approvedKeyframe,
      })),
      total: ordered.length,
      approved: ordered.filter((s) => s.approvedKeyframe).length,
    },
    allowedActions: ["generate_keyframe", "vary_keyframe", "validate_storyboard"],
    blockedActions: ["generate_video", "validate_scene", "assemble_final"],
    implicitReferent: "el plan completo del corto (todos los planos)",
  });

  const scopeOf = (shotId: string) => {
    const shot = project.shots.find((s) => s.id === shotId);
    if (!shot) return "Storyboard";
    return `Escena ${sceneNumberOf(shot.sceneId)} · Plano ${shot.order}`;
  };

  const getActions = (): BlockAction[] => [
    {
      id: "generate_keyframe",
      label: "Generar keyframes pendientes",
      hint: "Genera la imagen de los planos sin keyframe.",
      generative: true,
      enabled: !locked,
      run: async (arg) => {
        const targets = arg?.shotId
          ? [arg.shotId]
          : ordered.filter((s) => !s.keyframeUrl).map((s) => s.id);
        for (const id of targets) {
          await runShotGeneration(api, {
            shotId: id,
            field: "keyframe",
            kind: "image",
            phase: "storyboard",
            scopeLabel: scopeOf(id),
          });
        }
      },
    },
    {
      id: "vary_keyframe",
      label: "Variar ángulo",
      hint: "Regenera con una variación de encuadre.",
      generative: true,
      enabled: !locked,
      run: async (arg) => {
        const id = arg?.shotId ?? ordered[0]?.id;
        if (!id) return;
        api.update((d) => {
          const s = d.shots.find((x) => x.id === id)!;
          if (!/ángulo/i.test(s.keyframePrompt)) {
            s.keyframePrompt += ", variación de ángulo, encuadre alternativo";
          }
        });
        await runShotGeneration(api, {
          shotId: id,
          field: "keyframe",
          kind: "image",
          phase: "storyboard",
          scopeLabel: scopeOf(id),
        });
      },
    },
    {
      id: "validate_storyboard",
      label: "Validar storyboard → ir a Producción",
      hint: "Requiere todos los planos clave aprobados.",
      enabled: allApproved && !locked,
      run: () => storyboardBlock.validate(),
    },
  ];

  const storyboardBlock: PipelineBlock = {
    id: "storyboard",
    label: "Storyboard",
    icon: "",
    getPageContext,
    getActions,
    consume: (_input: BlockInput) => {
      /* receives validated scenes */
    },
    produce: (): BlockOutput => ({
      phase: "storyboard",
      payload: {
        shots: project.shots.filter((s) => s.approvedKeyframe).map((s) => s.id),
      },
    }),
    getGateState: () => {
      const g = project.gates.storyboard;
      if (g === "validated" || g === "locked") return g;
      return allApproved ? "ready" : "in_progress";
    },
    validate: () => {
      api.update((d) => {
        d.gates.storyboard = "validated";
        // Open production: every scene starts in_progress.
        for (const sc of d.scenes) {
          if (!d.gates.production[sc.id]) d.gates.production[sc.id] = "in_progress";
        }
      });
    },
    render: () => <StoryboardPage />,
  };

  return storyboardBlock;
}
