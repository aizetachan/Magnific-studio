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
  loadProjectFromDir,
  saveProject,
  setUrlProject,
} from "./persistence";
import { initLocalDir, localDirStatus, subscribeLocalDir } from "./localdir";
import { hydrateAssetRefs, preloadLocalAssets } from "./assets";
import { getCredentials, subscribeCredentials } from "./credentials";

/**
 * Overlay the GLOBAL credentials (Anthropic key / model / connection status)
 * onto a freshly loaded project's settings, so connecting once works in every
 * project (they're stripped from per-project storage). Mutates and returns p.
 */
function applyCreds(p: Project): Project {
  const c = getCredentials();
  p.settings.anthropicApiKey = c.anthropicApiKey;
  p.settings.directorModel = c.directorModel;
  p.settings.connectionTested = c.connectionTested;
  return p;
}

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
  /** Load another existing project into THIS tab (same-tab switch). */
  switchProject: (id: string) => void;
  /** Create a blank project and open it in THIS tab; returns its id. */
  createProject: () => string;
}

const Ctx = createContext<StoreValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => {
    const id = currentProjectId();
    return applyCreds((id ? loadProject(id) : null) ?? createBlankProject());
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

  // Keep the current project's settings in sync with the GLOBAL credentials, so
  // editing them in Settings (Home) applies immediately to the open project.
  useEffect(
    () =>
      subscribeCredentials(() => {
        const c = getCredentials();
        setProject((prev) => {
          if (
            prev.settings.anthropicApiKey === c.anthropicApiKey &&
            prev.settings.directorModel === c.directorModel &&
            prev.settings.connectionTested === c.connectionTested
          )
            return prev;
          const next = structuredClone(prev) as Project;
          next.settings.anthropicApiKey = c.anthropicApiKey;
          next.settings.directorModel = c.directorModel;
          next.settings.connectionTested = c.connectionTested;
          return next;
        });
      }),
    [],
  );

  // Autosave to this machine's localStorage + the linked working folder
  // (debounced to avoid thrashing). The event feeds the unsaved-changes guard.
  useEffect(() => {
    const t = setTimeout(() => {
      saveProject(project);
      window.dispatchEvent(new Event("ms:project-saved"));
    }, 400);
    return () => clearTimeout(t);
  }, [project]);

  // Local-first: (a) recover the project from the linked working folder when
  // this browser's localStorage doesn't have it, and (b) hydrate local:assets
  // refs into runtime blob: URLs once their bytes are available (folder or
  // IndexedDB). Re-runs when the folder becomes ready (permission re-grant).
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      await preloadLocalAssets(projectRef.current);
      if (!alive) return;
      setProject((prev) => {
        const clone = structuredClone(prev) as Project;
        return hydrateAssetRefs(clone) ? clone : prev;
      });
    };
    void initLocalDir().then(async () => {
      const id = currentProjectId();
      if (id && !loadProject(id)) {
        const fromDisk = await loadProjectFromDir(id);
        if (alive && fromDisk) {
          setProject(applyCreds(fromDisk));
          projectRef.current = fromDisk;
        }
      }
      await hydrate();
    });
    const unsub = subscribeLocalDir(() => {
      if (localDirStatus() === "ready") void hydrate();
    });
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

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
    // Counts as "took a copy" for the unsaved-changes guard (fallback mode).
    window.dispatchEvent(new Event("ms:exported"));
    return JSON.stringify(safe, null, 2);
  }, [project]);

  const importJson = useCallback(
    (json: string) => {
      const parsed = JSON.parse(json) as Project;
      // Keep the live secrets from the current session (global key + magnific).
      applyCreds(parsed);
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

  // Switch to another existing project IN THIS TAB.
  const switchProject = useCallback((id: string) => {
    const p = loadProject(id);
    if (!p) return;
    setProject(applyCreds(p));
    setUrlProject(id);
  }, []);

  // Create a blank project and open it IN THIS TAB.
  const createProject = useCallback(() => {
    const p = createBlankProject();
    saveProject(p);
    setProject(applyCreds(p));
    setUrlProject(p.id);
    return p.id;
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
      switchProject,
      createProject,
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
      switchProject,
      createProject,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within ProjectProvider");
  return v;
}
