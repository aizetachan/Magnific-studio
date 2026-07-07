import {
  IconBolt,
  IconBook,
  IconChevronLeft,
  IconCoin,
  IconLayoutGrid,
  IconLibrary,
  IconMovie,
  IconPackage,
  IconWriting,
  type IconProps,
} from "@tabler/icons-react";
import { type ComponentType, useState } from "react";
import type { PipelineBlock } from "@/types/pipeline";
import type { GateState, PhaseId } from "@/types/project";
import { BLOCK_ORDER } from "@/blocks";
import { useStore } from "@/state/ProjectStore";
import { totals } from "@/state/consumption";

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
 * Studio left sidebar — floating rounded panel. Top: logo (→ Home) + the project
 * name (editable). Below: the phase pipeline + Library. Bottom: the live
 * consumption chips (Claude / credits / cost). New projects are created from Home.
 */
export function Sidebar({
  blocks,
  activePhase,
  showLibrary,
  onSelectPhase,
  onSelectLibrary,
  onSelectHome,
}: {
  blocks: Record<PhaseId, PipelineBlock>;
  activePhase: PhaseId;
  showLibrary: boolean;
  onSelectPhase: (p: PhaseId) => void;
  onSelectLibrary: () => void;
  onSelectHome: () => void;
}) {
  const { project, update } = useStore();
  const t = totals(project);
  const claude = project.settings.connectionTested; // "ok" | "failed" | "untested"
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  const commit = () => {
    update((d) => {
      d.name = draft.trim() || "Proyecto sin título";
    });
    setEditing(false);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo" role="button" title="Ir a Home" style={{ cursor: "pointer" }} onClick={onSelectHome}>
          <svg className="sidebar__logo-mark" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" fill="none" aria-label="Magnific">
            <path d="M18.4806 8L16.0805 13.862L13.6815 8H8.88124L4.08095 25C4.01661 25 10.0807 25 10.0807 25L16.0805 17.3789L22.0802 25C22.0802 25 28.1443 25 28.0799 25L23.2809 8H18.4806Z" fill="currentColor" />
          </svg>
          <IconChevronLeft className="sidebar__logo-back" size={20} stroke={2.5} />
        </div>
        {editing ? (
          <input
            className="sidebar__projname-edit"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(project.name); setEditing(false); }
            }}
          />
        ) : (
          <div
            className="sidebar__projname"
            title="Doble clic para renombrar"
            onDoubleClick={() => { setDraft(project.name); setEditing(true); }}
          >
            {project.name}
          </div>
        )}
      </div>

      <ul className="sidebar__nav">
        {BLOCK_ORDER.map((id) => {
          const block = blocks[id];
          const gate = block.getGateState();
          const locked = gate === "locked";
          const active = !showLibrary && id === activePhase;
          const PhaseIcon = PHASE_ICON[id];
          return (
            <li key={id}>
              <button
                className={`navitem ${active ? "navitem--active" : ""} ${locked ? "navitem--locked" : ""}`}
                disabled={locked}
                title={GATE_HINT[gate]}
                onClick={() => onSelectPhase(id)}
              >
                <span className="navitem__icon"><PhaseIcon size={14} /></span>
                <span className="navitem__label">{block.label}</span>
                <span className={`gate-dot gate-dot--${gate}`} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sidebar__sep" />

      <button className={`navitem ${showLibrary ? "navitem--active" : ""}`} onClick={onSelectLibrary}>
        <span className="navitem__icon"><IconLibrary size={14} /></span>
        <span className="navitem__label">Biblioteca</span>
      </button>

      <div className="sidebar__bottom">
        <div className="sidebar__chips">
          <span className="meter" title={`Claude ${claude === "ok" ? "conectado" : claude === "failed" ? "sin conexión" : "sin probar"}`}>
            <span className={`status-dot status-dot--${claude}`} /> Claude
          </span>
          <span className="meter" title="Créditos de Magnific consumidos">
            <IconBolt size={14} /> {t.magnificCredits} cr
          </span>
          <span className="meter" title="Coste estimado de la API de Claude">
            <IconCoin size={14} /> ${t.claudeCostUsd.toFixed(2)}
          </span>
        </div>
      </div>
    </nav>
  );
}
