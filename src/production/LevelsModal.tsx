import { useState } from "react";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { addLevelOnTop, removeTopLevel, renumber, type LevelDef } from "./model";
import { useProduction } from "./store";

/**
 * Level template editor. The LAST level is always the work unit (cards); the
 * others are folders. Levels are added/removed at the top (e.g. Episodio over
 * Secuencia) so existing structure is never lost.
 */
export function LevelsModal({ onClose }: { onClose: () => void }) {
  const { prod, update } = useProduction();
  const [draft, setDraft] = useState({ name: "Episodio", prefix: "EP" });
  const [msg, setMsg] = useState("");

  const setLevel = (i: number, patch: Partial<LevelDef>) =>
    update((d) => {
      Object.assign(d.levels[i], patch);
      if (patch.step) {
        const parents = new Set(d.nodes.filter((n) => n.level === i).map((n) => n.parentId));
        parents.forEach((pid) => renumber(d, pid));
      }
    });

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3>Niveles de la producción</h3>
          <button className="icon-btn" onClick={onClose}><IconX size={16} /></button>
        </div>
        <p className="muted small">
          Cada nivel es una carpeta, en la app y en el disco. El último es la unidad de trabajo (las cards).
          En los niveles con «Genera» se puede producir directamente, por ejemplo una escena de 30 s que luego
          se corta y se reparte a sus planos.
        </p>
        <table className="levels">
          <thead>
            <tr><th>Nivel</th><th>Prefijo</th><th>Salto</th><th>Dígitos</th><th>Genera</th><th>Máx. vídeo</th><th /></tr>
          </thead>
          <tbody>
            {prod.levels.map((l, i) => (
              <tr key={l.id}>
                <td><input value={l.name} onChange={(e) => setLevel(i, { name: e.target.value })} /></td>
                <td><input className="w-s" value={l.prefix} onChange={(e) => setLevel(i, { prefix: e.target.value.toUpperCase() })} /></td>
                <td><input className="w-s" type="number" min={1} value={l.step} onChange={(e) => setLevel(i, { step: Math.max(1, +e.target.value) })} /></td>
                <td><input className="w-s" type="number" min={1} max={6} value={l.pad} onChange={(e) => setLevel(i, { pad: Math.max(1, Math.min(6, +e.target.value)) })} /></td>
                <td><input type="checkbox" checked={l.canGenerate} onChange={(e) => setLevel(i, { canGenerate: e.target.checked })} /></td>
                <td><input className="w-s" type="number" min={1} max={120} value={l.maxVideoSec} onChange={(e) => setLevel(i, { maxVideoSec: Math.max(1, +e.target.value) })} /> s</td>
                <td className="muted small">
                  {i === prod.levels.length - 1 ? "unidad" : i === 0 && prod.levels.length > 1 ? (
                    <button className="icon-btn" title="Quitar este nivel" onClick={() => {
                      let ok = false;
                      update((d) => void (ok = removeTopLevel(d)));
                      setMsg(ok ? "" : "Solo se puede quitar si tiene como mucho una carpeta (para no perder estructura).");
                    }}><IconTrash size={13} /></button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {msg ? <p className="bad small">{msg}</p> : null}
        <div className="np__row">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="w-s" value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value.toUpperCase() })} />
          <button className="btn" onClick={() => update((d) =>
            addLevelOnTop(d, { name: draft.name || "Nivel", prefix: draft.prefix || "LV", step: 1, pad: 2, canGenerate: false, maxVideoSec: 30 }),
          )}>
            <IconPlus size={14} /> Añadir nivel arriba
          </button>
        </div>
      </div>
    </div>
  );
}
