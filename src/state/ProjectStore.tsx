import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { reconcileInflight } from "@/blocks/runner";
import { createBlankProject, uid } from "./seed";
import {
  currentProjectId,
  loadProject,
  saveProject,
  setUrlProject,
} from "./persistence";

/**
 * Central project store. State is held in memory (React) and autosaved to this
 * machine's localStorage so a reload never loses work (local-per-machine; see
 * persistence.ts). It stays fully serializable for JSON export/import. The
 * GenerationBlock lives here as a stable singleton so jobs survive re-renders.
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
  /** Create a blank project and open it in a new browser tab. */
  openNewProjectTab: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => {
    const id = currentProjectId();
    return (id ? loadProject(id) : null) ?? createBlankProject();
  });
  const [activePhase, setActivePhase] = useState<PhaseId>("story");
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const generationRef = useRef<GenerationBlock>();
  if (!generationRef.current) {
    generationRef.current = new GenerationBlock({
      apiConnected: project.settings.magnificApiConnected,
    });
  }
  const generation = generationRef.current;

  // Keep the generation layer's transports in sync with Settings.
  useEffect(() => {
    generation.setApiConnected(project.settings.magnificApiConnected);
    generation.setMagnificAuth(project.settings.magnificApiKey);
  }, [
    generation,
    project.settings.magnificApiConnected,
    project.settings.magnificApiKey,
  ]);

  // Bind this tab to its project id in the URL (so reload/share reopens it).
  useEffect(() => {
    setUrlProject(project.id);
  }, [project.id]);

  // Autosave to this machine's localStorage (debounced to avoid thrashing).
  useEffect(() => {
    const t = setTimeout(() => saveProject(project), 400);
    return () => clearTimeout(t);
  }, [project]);

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

  // On load, resume any generation that was still "rendering" (survive reload):
  // the backend sweeper keeps finishing them; we poll to pull in the result.
  const reconciled = useRef(false);
  useEffect(() => {
    if (reconciled.current) return;
    reconciled.current = true;
    reconcileInflight({ project, update, meter, generation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportJson = useCallback(() => {
    // Never export secrets.
    const safe = structuredClone(project) as Project;
    safe.settings.anthropicApiKey = "";
    safe.settings.magnificApiKey = "";
    return JSON.stringify(safe, null, 2);
  }, [project]);

  const importJson = useCallback(
    (json: string) => {
      const parsed = JSON.parse(json) as Project;
      // Keep the live keys from the current session.
      parsed.settings.anthropicApiKey = project.settings.anthropicApiKey;
      parsed.settings.magnificApiKey = project.settings.magnificApiKey;
      setProject(parsed);
    },
    [project.settings.anthropicApiKey, project.settings.magnificApiKey],
  );

  // New project opens in a NEW TAB (the current project stays open here).
  const openNewProjectTab = useCallback(() => {
    const p = createBlankProject();
    saveProject(p);
    window.open(`${window.location.pathname}?p=${p.id}`, "_blank");
  }, []);

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
      openNewProjectTab,
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
      openNewProjectTab,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within ProjectProvider");
  return v;
}
