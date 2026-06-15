import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { ActiveBlockContext } from "@/state/ActiveBlock";
import { buildBlocks } from "@/blocks";
import { config } from "@/config";
import { Sidebar } from "@/components/Sidebar";
import { Director } from "@/director/Director";
import { SettingsPage } from "@/settings/SettingsPage";
import { Topbar } from "@/components/Topbar";

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
      <span>Conecta tu cuenta de Magnific para poder generar.</span>
      <a className="conn-banner__cta" href={`${config.directorBase}/auth/login`}>
        Conectar mi cuenta
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
      setInfo({ kind: "ok", text: "Cuenta de Magnific conectada. Ya puedes generar." });
    else if (s === "unconfigured")
      setInfo({ kind: "warn", text: "El backend no tiene MAGNIFIC_MCP_URL configurado." });
    else if (s === "error")
      setInfo({ kind: "err", text: `No se pudo conectar a Magnific: ${p.get("detail") ?? "error"}` });
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
  const [showSettings, setShowSettings] = useState(false);

  // Live blocks built from the current store snapshot (decoupled by interface).
  const blocks = useMemo(
    () => buildBlocks(store),
    // Rebuild whenever project/scene focus changes so context stays fresh.
    [store],
  );
  const activeBlock = blocks[store.activePhase];

  return (
    <ActiveBlockContext.Provider value={activeBlock}>
      <div className="app">
        <OAuthBanner />
        <ConnectionBanner />
        <Sidebar
          projectName={store.project.name}
          blocks={blocks}
          activePhase={store.activePhase}
          showSettings={showSettings}
          onSelectPhase={(p) => {
            store.setActivePhase(p);
            setShowSettings(false);
          }}
          onSelectSettings={() => setShowSettings(true)}
        />
        <main className="main">
          <Topbar />
          <div className="main__scroll">
            <div className="content-panel">
              {showSettings ? <SettingsPage /> : activeBlock.render()}
            </div>
          </div>
          <Director />
        </main>
      </div>
    </ActiveBlockContext.Provider>
  );
}
