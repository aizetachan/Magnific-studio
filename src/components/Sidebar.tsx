import type { PipelineBlock } from "@/types/pipeline";
import type { GateState, PhaseId } from "@/types/project";
import { BLOCK_ORDER } from "@/blocks";
import { useStore } from "@/state/ProjectStore";

const GATE_HINT: Record<GateState, string> = {
  locked: "Bloqueada",
  in_progress: "En progreso",
  ready: "Lista para validar",
  validated: "Validada",
};

/**
 * Left sidebar — Magnific design language: floating rounded panel (panel-4),
 * ghost hovers, per-phase category color on the icon box, pink create button.
 * Wider than Magnific's 72px icon rail because Studio navigates named phases.
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
  const { newProject } = useStore();

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">M</div>
        <div className="sidebar__brandtext">
          <div className="sidebar__suite">Magnific</div>
          <strong className="sidebar__app">Studio</strong>
        </div>
        <button
          className="sidebar__create"
          title="Nuevo proyecto"
          onClick={() => {
            if (confirm("¿Empezar un proyecto nuevo? Se perderá lo no exportado."))
              newProject();
          }}
        >
          +
        </button>
      </div>

      <div className="sidebar__project">
        <span className="sidebar__plabel">PROYECTO</span>
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
                <span className={`navitem__icon cat-${id}`}>{block.icon}</span>
                <span className="navitem__label">{block.label}</span>
                <span className={`gate-dot gate-dot--${gate}`} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sidebar__sep" />

      <button
        className={`navitem ${showSettings ? "navitem--active" : ""}`}
        onClick={onSelectSettings}
      >
        <span className="navitem__icon cat-settings">⚙️</span>
        <span className="navitem__label">Ajustes</span>
      </button>

      <div className="sidebar__foot">
        Pipeline secuencial con gates. Vuelve atrás para iterar.
      </div>
    </nav>
  );
}
