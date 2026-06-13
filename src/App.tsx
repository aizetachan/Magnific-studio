import { useMemo, useState } from "react";
import { useStore } from "@/state/ProjectStore";
import { ActiveBlockContext } from "@/state/ActiveBlock";
import { buildBlocks } from "@/blocks";
import { Sidebar } from "@/components/Sidebar";
import { Director } from "@/director/Director";
import { SettingsPage } from "@/settings/SettingsPage";
import { Topbar } from "@/components/Topbar";

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
            {showSettings ? <SettingsPage /> : activeBlock.render()}
          </div>
          <Director />
        </main>
      </div>
    </ActiveBlockContext.Provider>
  );
}
