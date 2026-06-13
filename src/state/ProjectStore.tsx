import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ConsumptionEvent,
  PhaseId,
  Project,
} from "@/types/project";
import { GenerationBlock } from "@/generation/GenerationBlock";
import { createSeedProject, uid } from "./seed";

/**
 * Central project store. State is held in memory (React) and is fully
 * serializable for JSON export/import — no browser storage in the MVP (§5.6).
 * The GenerationBlock lives here as a stable singleton so jobs survive
 * re-renders.
 */

export interface StoreValue {
  project: Project;
  activePhase: PhaseId;
  setActivePhase: (p: PhaseId) => void;
  /** Active scene in the Production workspace (UI state, not persisted). */
  activeSceneId: string | null;
  setActiveSceneId: (id: string | null) => void;
  /** Immutable update via a draft mutator. */
  update: (mut: (draft: Project) => void) => void;
  /** Record a consumption event (Claude tokens or Magnific credits). */
  meter: (e: Omit<ConsumptionEvent, "id" | "at">) => void;
  generation: GenerationBlock;
  exportJson: () => string;
  importJson: (json: string) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(createSeedProject);
  const [activePhase, setActivePhase] = useState<PhaseId>("story");
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const generationRef = useRef<GenerationBlock>();
  if (!generationRef.current) {
    generationRef.current = new GenerationBlock({
      apiConnected: project.settings.magnificApiConnected,
    });
  }
  const generation = generationRef.current;

  const update = useCallback((mut: (draft: Project) => void) => {
    setProject((prev) => {
      const draft = structuredClone(prev) as Project;
      mut(draft);
      return draft;
    });
  }, []);

  const meter = useCallback(
    (e: Omit<ConsumptionEvent, "id" | "at">) => {
      update((d) => {
        d.consumption.events.push({ ...e, id: uid("evt"), at: Date.now() });
      });
    },
    [update],
  );

  const exportJson = useCallback(() => {
    // Never export the API key.
    const safe = structuredClone(project) as Project;
    safe.settings.anthropicApiKey = "";
    return JSON.stringify(safe, null, 2);
  }, [project]);

  const importJson = useCallback(
    (json: string) => {
      const parsed = JSON.parse(json) as Project;
      // Keep the live API key from the current session.
      parsed.settings.anthropicApiKey = project.settings.anthropicApiKey;
      setProject(parsed);
      generation.setApiConnected(parsed.settings.magnificApiConnected);
    },
    [project.settings.anthropicApiKey, generation],
  );

  const value = useMemo<StoreValue>(
    () => ({
      project,
      activePhase,
      setActivePhase,
      activeSceneId,
      setActiveSceneId,
      update,
      meter,
      generation,
      exportJson,
      importJson,
    }),
    [
      project,
      activePhase,
      activeSceneId,
      update,
      meter,
      generation,
      exportJson,
      importJson,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within ProjectProvider");
  return v;
}
