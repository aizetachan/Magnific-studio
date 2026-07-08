import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  IconAlertTriangle,
  IconBook,
  IconLayoutGrid,
  IconLibrary,
  IconMovie,
  IconPackage,
  IconWriting,
  type IconProps,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { ActiveBlockContext } from "@/state/ActiveBlock";
import { LeadSlotContext } from "@/state/LeadSlot";
import { buildBlocks } from "@/blocks";
import { config } from "@/config";
import { t as tr, useI18n, type TKey } from "@/i18n";
import type { PhaseId } from "@/types/project";
import { Sidebar } from "@/components/Sidebar";
import { GateButton } from "@/components/GateButton";
import { HeaderActions } from "@/components/Topbar";
import { Director } from "@/director/Director";
import { LibraryPage } from "@/blocks/library/LibraryPage";
import { HomeShell } from "@/home/HomeShell";
import { WorkdirGate } from "@/components/WorkdirGate";
import { clearUrlProject } from "@/state/persistence";
import { ShareInbox } from "@/share/ShareInbox";
import { OnboardingTour } from "@/components/OnboardingTour";
import { AppAlert } from "@/components/AppAlert";
import { JoinGate } from "@/share/JoinGate";

/** Per-phase header metadata (icon + description + the gate that unlocks next). */
const PHASE_META: Record<
  PhaseId,
  { icon: ComponentType<IconProps>; desc: TKey; gateLabel?: TKey }
> = {
  story: { icon: IconBook, desc: "phase.story.desc", gateLabel: "phase.story.gate" },
  script: { icon: IconWriting, desc: "phase.script.desc", gateLabel: "phase.script.gate" },
  storyboard: { icon: IconLayoutGrid, desc: "phase.storyboard.desc", gateLabel: "phase.storyboard.gate" },
  production: { icon: IconMovie, desc: "phase.production.desc" },
  delivery: { icon: IconPackage, desc: "phase.delivery.desc" },
};

/** Persistent prompt to connect Magnific when live generation needs a session. */
function ConnectionBanner() {
  const [need, setNeed] = useState(false);
  useEffect(() => {
    if (!config.magnificLive) return;
    let alive = true;
    fetch(`${config.directorBase}/auth/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => alive && setNeed(!!d.configured && !d.connected))
      .catch(() => {});
  }, []);
  if (!need) return null;
  return (
    <div className="conn-banner" role="status">
      <IconAlertTriangle size={16} />
      <span>{tr("banner.connectMagnific")}</span>
      <a className="conn-banner__cta" href={`${config.directorBase}/auth/login`}>
        {tr("banner.connectCta")}
      </a>
    </div>
  );
}

/** Global feedback for the OAuth return, visible on any page (not just Settings). */
function OAuthBanner() {
  const [info, setInfo] = useState<{
    kind: "ok" | "err" | "warn";
    text: string;
  } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("magnific");
    if (!s) return;
    if (s === "connected")
      setInfo({ kind: "ok", text: tr("banner.magnificConnected") });
    else if (s === "unconfigured")
      setInfo({ kind: "warn", text: tr("banner.magnificUnconfigured") });
    else if (s === "error")
      setInfo({ kind: "err", text: `${tr("banner.magnificError")} ${p.get("detail") ?? "error"}` });
    p.delete("magnific");
    p.delete("detail");
    const qs = p.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);
  if (!info) return null;
  return (
    <div className={`oauth-banner oauth-banner--${info.kind}`} role="status">
      <span>{info.text}</span>
      <button
        className="oauth-banner__x"
        aria-label="cerrar"
        onClick={() => setInfo(null)}
      >
        ×
      </button>
    </div>
  );
}

export function App() {
  const store = useStore();
  const { t } = useI18n();
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFocus, setLibraryFocus] = useState<string | null>(null);
  // Slot in the page lead row where pages can portal controls (e.g. tabs).
  const [leadSlot, setLeadSlot] = useState<HTMLElement | null>(null);
  // Home is the initial screen; a deep link (?p=) lands straight in the Studio.
  const [view, setView] = useState<"home" | "studio">(() =>
    new URLSearchParams(window.location.search).has("p") ? "studio" : "home",
  );

  // Going back to the dashboard: Home has its own URL (/home), so a reload
  // lands on Home by default instead of re-opening the last file.
  const goHome = () => {
    clearUrlProject();
    setView("home");
  };

  // Normalize the URL when the session starts on the dashboard.
  useEffect(() => {
    if (view === "home") clearUrlProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-enter the studio (accepted invite / approved join link).
  useEffect(() => {
    const enter = () => setView("studio");
    window.addEventListener("ms:enter-studio", enter);
    return () => window.removeEventListener("ms:enter-studio", enter);
  }, []);

  // "Ir a Ajustes" from anywhere (e.g. the connect-API modal): switch to Home,
  // where HomeShell/SettingsPage pick up the pending target section.
  useEffect(() => {
    const go = () => goHome();
    window.addEventListener("ms:open-settings", go);
    return () => window.removeEventListener("ms:open-settings", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link from anywhere (e.g. Historia's edit icon) to the Library, focused
  // on a specific asset.
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ assetId?: string }>).detail?.assetId ?? null;
      setLibraryFocus(id);
      setShowLibrary(true);
    };
    window.addEventListener("ms:open-library", open);
    return () => window.removeEventListener("ms:open-library", open);
  }, []);

  // Pink "what changed" highlight: any element with [data-flash="<id>"] flashes
  // when the Director (or anything) dispatches ms:flash with that target.
  useEffect(() => {
    const onFlash = (e: Event) => {
      const target = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (!target) return;
      // Defer so a page switch (if any) has mounted the element.
      setTimeout(() => {
        const el = document.querySelector(`[data-flash="${target}"]`);
        if (!el) return;
        el.classList.add("flash");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el.classList.remove("flash"), 2400);
      }, 60);
    };
    window.addEventListener("ms:flash", onFlash);
    return () => window.removeEventListener("ms:flash", onFlash);
  }, []);

  // Live blocks built from the current store snapshot (decoupled by interface).
  const blocks = useMemo(
    () => buildBlocks(store),
    // Rebuild whenever project/scene focus changes so context stays fresh.
    [store],
  );
  const activeBlock = blocks[store.activePhase];

  if (view === "home") {
    return (
      <>
        <WorkdirGate />
        <OnboardingTour />
        <ShareInbox />
        <AppAlert />
        <JoinGate />
        <HomeShell onEnterStudio={() => setView("studio")} />
      </>
    );
  }

  const meta = PHASE_META[store.activePhase];
  const HeaderIcon = showLibrary ? IconLibrary : meta.icon;
  const headerTitle = showLibrary ? "Biblioteca" : activeBlock.label;
  const headerDesc = showLibrary
    ? "Personajes, entornos y estilo reutilizables para mantener la consistencia visual en todas las escenas. Créalos aquí antes de producir."
    : t(meta.desc);
  const gateLabel = showLibrary ? undefined : meta.gateLabel ? t(meta.gateLabel) : undefined;

  return (
    <ActiveBlockContext.Provider value={activeBlock}>
      <LeadSlotContext.Provider value={leadSlot}>
      <div className="app">
        <WorkdirGate />
        <OnboardingTour />
        <ShareInbox />
        <AppAlert />
        <JoinGate />
        <OAuthBanner />
        <ConnectionBanner />
        <Sidebar
          blocks={blocks}
          activePhase={store.activePhase}
          showLibrary={showLibrary}
          onSelectPhase={(p) => {
            store.setActivePhase(p);
            setShowLibrary(false);
          }}
          onSelectLibrary={() => setShowLibrary(true)}
          onSelectHome={goHome}
        />
        <main className="main">
          {/* Full-width header bar, outside the scrolling content container. */}
          <div className="main__headbar">
            <header className="page__head">
              <div>
                <h1><HeaderIcon size={24} /> {headerTitle}</h1>
              </div>
              <div className="page__head-actions">
                {/* Global actions (icon-only) on the left, validation gate at the far right. */}
                <HeaderActions />
                {gateLabel ? (
                  <GateButton
                    state={activeBlock.getGateState()}
                    label={gateLabel}
                    onValidate={activeBlock.validate}
                    pending={
                      store.activePhase === "storyboard"
                        ? store.project.shots.filter((s) => !s.approvedKeyframe).length
                        : undefined
                    }
                  />
                ) : null}
              </div>
            </header>
          </div>
          <div className="main__scroll">
            <div className="content-panel">
              {/* Lead row at the top of the content: description (left) + a slot
                  where the page can portal controls like tabs (right). */}
              <div className="page__lead">
                <p className="muted page__desc">{headerDesc}</p>
                <div className="page__lead-slot" ref={setLeadSlot} />
              </div>
              {showLibrary ? (
                <LibraryPage focusAssetId={libraryFocus} />
              ) : (
                activeBlock.render()
              )}
            </div>
          </div>
          <Director />
        </main>
      </div>
      </LeadSlotContext.Provider>
    </ActiveBlockContext.Provider>
  );
}
