import { describe, expect, it, vi } from "vitest";
import { resolveIntent } from "./orchestrator";
import type { BlockAction, PageContext } from "@/types/pipeline";

const productionScene3Ctx: PageContext = {
  phase: "production",
  phaseLabel: "Producción → Escena 3",
  visibleObjects: {
    activeSceneId: "scene_3",
    // Only scene 3's shots are visible -> "plano 2" must resolve HERE.
    shots: [
      { id: "shot_3_1", order: 1, approved: false },
      { id: "shot_3_2", order: 2, approved: false },
    ],
  },
  allowedActions: ["generate_video", "validate_scene"],
  blockedActions: ["generate_keyframe", "validate_storyboard", "assemble_final"],
  implicitReferent: "los planos de la Escena 3",
};

const storyCtx: PageContext = {
  phase: "story",
  phaseLabel: "Historia",
  visibleObjects: {},
  allowedActions: ["develop_story", "rewrite_story"],
  blockedActions: ["generate_video", "generate_keyframe", "generate_script"],
  implicitReferent: "la historia",
};

function action(id: string): BlockAction {
  return { id, label: id, enabled: true, run: vi.fn() };
}

describe("Orchestrator — page-context awareness (§4)", () => {
  it('resolves "el plano 2" to plano 2 of the ACTIVE scene', () => {
    const actions = [action("generate_video")];
    const r = resolveIntent(
      "haz el plano 2 más cinematográfico",
      productionScene3Ctx,
      actions,
    );
    expect(r.redirected).toBe(false);
    expect(r.action?.id).toBe("generate_video");
    expect(r.arg?.shotId).toBe("shot_3_2");
    expect(r.arg?.sceneId).toBe("scene_3");
  });

  it("softly redirects an out-of-phase request instead of executing", () => {
    const actions = [action("develop_story")];
    const r = resolveIntent("genera el vídeo ya", storyCtx, actions);
    expect(r.redirected).toBe(true);
    expect(r.action).toBeUndefined();
    expect(r.reply).toMatch(/Producci[óo]n/);
  });

  it("fires an in-scope action", () => {
    const actions = [action("develop_story")];
    const r = resolveIntent(
      "desarrolla la historia desde esta idea",
      storyCtx,
      actions,
    );
    expect(r.redirected).toBe(false);
    expect(r.action?.id).toBe("develop_story");
  });
});
