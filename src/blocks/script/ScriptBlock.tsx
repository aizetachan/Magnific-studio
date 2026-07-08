import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { generateScript } from "@/director/generate";
import { ScriptPage } from "./ScriptPage";
import { showAppAlert } from "@/components/AppAlert";

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

  const getActions = (): BlockAction[] => [
    {
      id: "generate_script",
      label: "Generar guion desde la historia",
      hint: "Claude crea las escenas y sus planos recomendados.",
      generative: true,
      enabled: !locked,
      run: async () => {
        try {
          await generateScript(api);
        } catch (e) {
          showAppAlert(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];

  return {
    id: "script",
    label: "Guion",
    icon: "",
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
