import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { uid } from "@/state/seed";
import { StoryPage } from "./StoryPage";

/**
 * Story block — develops narrative only. NO image/video here (§2.1).
 * Claude's scope: rewrite arcs/tone/characters; blocked from any generation.
 */
export function buildStoryBlock(api: StoreValue): PipelineBlock {
  const { project } = api;

  const getPageContext = (): PageContext => ({
    phase: "story",
    phaseLabel: "Historia",
    visibleObjects: {
      logline: project.story.logline,
      characters: project.story.characters.map((c) => c.name),
      arcs: project.story.arcs.map((a) => a.title),
      tone: project.story.tone,
    },
    allowedActions: ["develop_story", "rewrite_story"],
    blockedActions: [
      "generate_script",
      "rewrite_scene",
      "generate_keyframe",
      "vary_keyframe",
      "generate_video",
      "validate_scene",
      "assemble_final",
    ],
    implicitReferent: "la historia (logline, personajes, arcos, tono)",
  });

  const meterClaude = (label: string) =>
    api.meter({
      phase: "story",
      scope: "historia",
      kind: "claude",
      label,
      inputTokens: 320,
      outputTokens: 180,
      claudeCostUsd: project.settings.anthropicApiKey ? 0.006 : 0,
    });

  const getActions = (): BlockAction[] => [
    {
      id: "develop_story",
      label: "Desarrollar historia desde una idea",
      hint: "Claude expande logline, personajes y arcos.",
      enabled: true,
      run: () => {
        api.update((d) => {
          if (d.story.arcs.length < 3) {
            d.story.arcs.push({
              id: uid("arc"),
              title: "Resolución",
              description:
                "El precio de soltar la esfera redefine la identidad de Lía.",
            });
          }
          d.story.logline = d.story.logline.replace(/\.$/, "") + ".";
          if (d.gates.story === "in_progress" || d.gates.story === "locked") {
            d.gates.story = "ready";
          }
        });
        meterClaude("develop_story");
      },
    },
    {
      id: "rewrite_story",
      label: "Reescribir tono / arco / personaje",
      hint: "Reformula el tono manteniendo género y referencias.",
      enabled: true,
      run: () => {
        api.update((d) => {
          d.story.tone = d.story.tone.includes("(refinado)")
            ? d.story.tone
            : d.story.tone + " (refinado)";
          if (d.gates.story === "in_progress") d.gates.story = "ready";
        });
        meterClaude("rewrite_story");
      },
    },
  ];

  return {
    id: "story",
    label: "Historia",
    icon: "📖",
    getPageContext,
    getActions,
    consume: (_input: BlockInput) => {
      /* first phase: nothing to consume */
    },
    produce: (): BlockOutput => ({
      phase: "story",
      payload: { story: project.story },
    }),
    getGateState: () => project.gates.story,
    validate: () => {
      api.update((d) => {
        d.gates.story = "validated";
        if (d.gates.script === "locked") d.gates.script = "in_progress";
      });
    },
    render: () => <StoryPage />,
  };
}
