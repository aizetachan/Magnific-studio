import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { ScriptPage } from "./ScriptPage";

/**
 * Script block — works scene structure and text; prepares the scene->shots map
 * for the storyboard. No video here (§2.2).
 */
export function buildScriptBlock(api: StoreValue): PipelineBlock {
  const { project } = api;
  const locked = project.gates.script === "locked";

  const getPageContext = (): PageContext => ({
    phase: "script",
    phaseLabel: "Guion",
    visibleObjects: {
      scenes: project.scenes.map((s) => `${s.number}. ${s.heading}`),
      sceneCount: project.scenes.length,
    },
    allowedActions: ["generate_script", "rewrite_scene"],
    blockedActions: [
      "generate_keyframe",
      "vary_keyframe",
      "generate_video",
      "validate_scene",
      "assemble_final",
    ],
    implicitReferent: "las escenas del guion",
  });

  const meterClaude = (label: string) =>
    api.meter({
      phase: "script",
      scope: "guion",
      kind: "claude",
      label,
      inputTokens: 600,
      outputTokens: 420,
      claudeCostUsd: project.settings.anthropicApiKey ? 0.013 : 0,
    });

  const getActions = (): BlockAction[] => [
    {
      id: "generate_script",
      label: "Generar guion desde la historia",
      hint: "Deriva escenas a partir de logline y arcos.",
      enabled: !locked,
      run: () => {
        api.update((d) => {
          // Map story -> scenes (already seeded); mark structure ready.
          if (d.gates.script === "in_progress") d.gates.script = "ready";
        });
        meterClaude("generate_script");
      },
    },
    {
      id: "rewrite_scene",
      label: "Reescribir escena / ajustar ritmo",
      hint: "Reformula acción y diálogo; ajusta duración.",
      enabled: !locked,
      run: (arg) => {
        api.update((d) => {
          const target = arg?.sceneId
            ? d.scenes.find((s) => s.id === arg.sceneId)
            : d.scenes[0];
          if (target) target.durationSec = Math.max(4, target.durationSec - 2);
          if (d.gates.script === "in_progress") d.gates.script = "ready";
        });
        meterClaude("rewrite_scene");
      },
    },
  ];

  return {
    id: "script",
    label: "Guion",
    icon: "📝",
    getPageContext,
    getActions,
    consume: (_input: BlockInput) => {
      /* receives validated story */
    },
    produce: (): BlockOutput => ({
      phase: "script",
      payload: { scenes: project.scenes },
    }),
    getGateState: () => project.gates.script,
    validate: () => {
      api.update((d) => {
        d.gates.script = "validated";
        if (d.gates.storyboard === "locked") d.gates.storyboard = "in_progress";
      });
    },
    render: () => <ScriptPage />,
  };
}
