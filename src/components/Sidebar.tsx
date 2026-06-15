import {
  IconBook,
  IconLayoutGrid,
  IconMovie,
  IconPackage,
  IconPlus,
  IconSettings,
  IconWriting,
  type IconProps,
} from "@tabler/icons-react";
import { useState, type ComponentType } from "react";
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

const PHASE_ICON: Record<PhaseId, ComponentType<IconProps>> = {
  story: IconBook,
  script: IconWriting,
  storyboard: IconLayoutGrid,
  production: IconMovie,
  delivery: IconPackage,
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
  const { openNewProjectTab, update } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(projectName);

  const commitName = () => {
    const name = draftName.trim() || "Proyecto sin título";
    update((d) => {
      d.name = name;
    });
    setEditingName(false);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 32 32"
            fill="none"
            aria-label="Magnific"
          >
            <path
              d="M18.4806 8L16.0805 13.862L13.6815 8H8.88124L4.08095 25C4.01661 25 10.0807 25 10.0807 25L16.0805 17.3789L22.0802 25C22.0802 25 28.1443 25 28.0799 25L23.2809 8H18.4806Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div className="sidebar__brandtext">
          <div className="sidebar__suite">Magnific</div>
          <strong className="sidebar__app">Studio</strong>
        </div>
        <button
          className="sidebar__create"
          title="Nuevo proyecto (nueva pestaña)"
          onClick={openNewProjectTab}
        >
          <IconPlus size={18} />
        </button>
      </div>

      <div className="sidebar__project">
        <span className="sidebar__plabel">PROYECTO</span>
        {editingName ? (
          <input
            className="sidebar__projname-edit"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setDraftName(projectName);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <div
            className="sidebar__projname"
            title="Doble clic para renombrar"
            onDoubleClick={() => {
              setDraftName(projectName);
              setEditingName(true);
            }}
          >
            “{projectName}”
          </div>
        )}
      </div>

      <ul className="sidebar__nav">
        {BLOCK_ORDER.map((id) => {
          const block = blocks[id];
          const gate = block.getGateState();
          const locked = gate === "locked";
          const active = !showSettings && id === activePhase;
          const PhaseIcon = PHASE_ICON[id];
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
                <span className="navitem__icon">
                  <PhaseIcon size={14} />
                </span>
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
        <span className="navitem__icon">
          <IconSettings size={14} />
        </span>
        <span className="navitem__label">Ajustes</span>
      </button>

      <div className="sidebar__foot">
        Pipeline secuencial con gates. Vuelve atrás para iterar.
      </div>
    </nav>
  );
}
