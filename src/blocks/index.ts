import type { PipelineBlock } from "@/types/pipeline";
import type { PhaseId } from "@/types/project";
import type { StoreValue } from "@/state/ProjectStore";
import { buildStoryBlock } from "./story/StoryBlock";
import { buildScriptBlock } from "./script/ScriptBlock";
import { buildStoryboardBlock } from "./storyboard/StoryboardBlock";
import { buildProductionBlock } from "./production/ProductionBlock";
import { buildDeliveryBlock } from "./delivery/DeliveryBlock";

export type BlockBuilder = (api: StoreValue) => PipelineBlock;

/** Ordered pipeline. The orchestrator drives blocks by this list + gate state. */
export const BLOCK_ORDER: PhaseId[] = [
  "story",
  "script",
  "storyboard",
  "production",
  "delivery",
];

const BUILDERS: Record<PhaseId, BlockBuilder> = {
  story: buildStoryBlock,
  script: buildScriptBlock,
  storyboard: buildStoryboardBlock,
  production: buildProductionBlock,
  delivery: buildDeliveryBlock,
};

/** Build the live block objects from the current store snapshot. */
export function buildBlocks(api: StoreValue): Record<PhaseId, PipelineBlock> {
  return {
    story: BUILDERS.story(api),
    script: BUILDERS.script(api),
    storyboard: BUILDERS.storyboard(api),
    production: BUILDERS.production(api),
    delivery: BUILDERS.delivery(api),
  };
}
