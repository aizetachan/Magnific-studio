import { useEffect, useRef, useState } from "react";
import { IconPlus, IconSelector } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { listProjects, projectColor } from "@/state/persistence";

/**
 * Project switcher: colour chip + editable name + a chevron that opens a
 * dropdown to search and switch between projects (same tab) or create a new one.
 * Replaces the old "PROYECTO" label block.
 */
export function ProjectSwitcher() {
  const { project, update, switchProject, createProject } = useStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = () => {
    update((d) => {
      d.name = draft.trim() || "Proyecto sin título";
    });
    setEditing(false);
  };

  const projects = listProjects();
  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  return (
    <div className="psw" ref={ref}>
      <div className="psw__bar">
        <span className="psw__chip" style={{ background: projectColor(project.id) }} />
        {editing ? (
          <input
            className="psw__name-edit"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(project.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="psw__name"
            title="Doble clic para renombrar"
            onDoubleClick={() => {
              setDraft(project.name);
              setEditing(true);
            }}
          >
            {project.name}
          </span>
        )}
        <button className="psw__toggle" title="Cambiar de proyecto" onClick={() => setOpen((v) => !v)}>
          <IconSelector size={16} />
        </button>
      </div>

      {open ? (
        <div className="psw__menu">
          <div className="psw__menu-title">Selecciona un proyecto</div>
          <input
            className="psw__search"
            placeholder="Buscar proyectos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="psw__list">
            {filtered.map((p) => (
              <button
                key={p.id}
                className={`psw__item ${p.id === project.id ? "psw__item--active" : ""}`}
                onClick={() => {
                  if (p.id !== project.id) switchProject(p.id);
                  setOpen(false);
                }}
              >
                <span className="psw__chip" style={{ background: projectColor(p.id) }} />
                <span className="psw__item-name">{p.name}</span>
              </button>
            ))}
            {filtered.length === 0 ? <div className="muted small psw__empty">Sin resultados</div> : null}
          </div>
          <button
            className="psw__new"
            onClick={() => {
              createProject();
              setOpen(false);
            }}
          >
            <IconPlus size={15} /> Nuevo proyecto
          </button>
        </div>
      ) : null}
    </div>
  );
}
