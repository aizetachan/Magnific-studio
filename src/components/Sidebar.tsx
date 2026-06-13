import type { PipelineBlock } from "@/types/pipeline";
import type { GateState, PhaseId } from "@/types/project";
import { BLOCK_ORDER } from "@/blocks";

const GATE_HINT: Record<GateState, string> = {
  locked: "Bloqueada",
  in_progress: "En progreso",
  ready: "Lista para validar",
  validated: "Validada",
};

/**
 * Left sidebar: the project and its phases as navigable pages (not nodes).
 * The active phase is highlighted; not-yet-validated phases appear locked/dim.
 */
export function Sidebar({
  projectName,
  blocks,
  activePhase,
  showSettings,
  onSelectPhase,
  onSelectSettings,
}: {
  projectName: string;
  blocks: Record<PhaseId, PipelineBlock>;
  activePhase: PhaseId;
  showSettings: boolean;
  onSelectPhase: (p: PhaseId) => void;
  onSelectSettings: () => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">M</div>
        <div>
          <div className="sidebar__suite">Magnific</div>
          <strong className="sidebar__app">Studio</strong>
        </div>
      </div>

      <div className="sidebar__project">
        <span className="muted small">PROYECTO</span>
        <div className="sidebar__projname">“{projectName}”</div>
      </div>

      <ul className="sidebar__nav">
        {BLOCK_ORDER.map((id) => {
          const block = blocks[id];
          const gate = block.getGateState();
          const locked = gate === "locked";
          const active = !showSettings && id === activePhase;
          return (
            <li key={id}>
              <button
                className={`navitem ${active ? "navitem--active" : ""} ${
                  locked ? "navitem--locked" : ""
                }`}
                disabled={locked}
                title={GATE_HINT[gate]}
                onClick={() => onSelectPhase(id)}
              >
                <span className="navitem__icon">{block.icon}</span>
                <span className="navitem__label">{block.label}</span>
                <span className={`navitem__gate gate-dot gate-dot--${gate}`} />
              </button>
            </li>
          );
        })}
        <li className="sidebar__sep" />
        <li>
          <button
            className={`navitem ${showSettings ? "navitem--active" : ""}`}
            onClick={onSelectSettings}
          >
            <span className="navitem__icon">⚙️</span>
            <span className="navitem__label">Ajustes</span>
          </button>
        </li>
      </ul>

      <div className="sidebar__foot muted small">
        Pipeline secuencial con gates. Vuelve atrás para iterar.
      </div>
    </nav>
  );
}
