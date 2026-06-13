import { createContext, useContext } from "react";
import type { PipelineBlock } from "@/types/pipeline";

/**
 * The currently active block, provided by App. Pages and the Director surface
 * read it to render contextual actions, the page scope and the gate without
 * rebuilding blocks.
 */
export const ActiveBlockContext = createContext<PipelineBlock | null>(null);

export function useActiveBlock(): PipelineBlock {
  const b = useContext(ActiveBlockContext);
  if (!b) throw new Error("useActiveBlock must be used within ActiveBlockContext");
  return b;
}
