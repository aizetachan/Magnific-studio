import type {
  BlockAction,
  BlockInput,
  BlockOutput,
  PageContext,
  PipelineBlock,
} from "@/types/pipeline";
import type { StoreValue } from "@/state/ProjectStore";
import { generateStory } from "@/director/generate";
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

  const runGenerate = async () => {
    try {
      await generateStory(api);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const getActions = (): BlockAction[] => [
    {
      id: "develop_story",
      label: "Desarrollar historia desde una idea",
      hint: "Claude expande logline, personajes y arcos desde tu idea.",
      generative: true,
      enabled: true,
      run: runGenerate,
    },
    {
      id: "rewrite_story",
      label: "Reescribir tono / arco / personaje",
      hint: "Claude reformula la historia manteniendo la esencia.",
      generative: true,
      enabled: true,
      run: runGenerate,
    },
  ];

  return {
    id: "story",
    label: "Historia",
    icon: "",
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
