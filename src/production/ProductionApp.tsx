import { useEffect, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconLayersSubtract,
  IconMessage,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import {
  addNode,
  ancestors,
  childrenOf,
  codeOf,
  insertAfter,
  isUnit,
  moveNode,
  nodeDuration,
  progressOf,
  removeNode,
  roleOf,
  STATUS_LABEL,
  type Media,
  type ProdNode,
  type Production,
} from "./model";
import { useProduction } from "./store";
import { mirrorAll, pickDirectory, rehydrate, requestAccess, useFolder } from "./mirror";
import { generateBatch } from "./generate";
import { NodePanel } from "./NodePanel";
import { LevelsModal } from "./LevelsModal";

/** Best thumbnail for a node: its selected take's media, else its latest ready media. */
export function coverOf(p: Production, n: ProdNode): { media?: Media; inSec?: number } {
  const take = n.selectedTakeId ? p.takes.find((t) => t.id === n.selectedTakeId) : undefined;
  const tm = take ? p.media.find((m) => m.id === take.mediaId) : undefined;
  if (tm) return { media: tm, inSec: take!.inSec };
  const own = p.media.filter((m) => m.nodeId === n.id && m.status === "ready");
  return { media: own[own.length - 1] };
}

export const isPlayable = (m?: Media) => !!m?.url && m.kind === "video" && !m.url.startsWith("data:image");

export function Thumb({ media, inSec }: { media?: Media; inSec?: number }) {
  if (!media?.url) {
    return <div className="thumb thumb--empty">{media && media.status !== "failed" ? <span className="spin" /> : <IconPhoto size={18} />}</div>;
  }
  return (
    <div className="thumb">
      {isPlayable(media) ? (
        <video src={`${media.url}#t=${inSec ?? 0}`} muted preload="metadata" />
      ) : (
        <img src={media.url} alt="" />
      )}
      {media.kind === "video" ? <span className="thumb__badge"><IconVideo size={11} /></span> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: ProdNode["status"] }) {
  return <span className={`pill pill--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function ProductionApp() {
  const store = useProduction();
  const { prod, update, selectedId, select, user, setUser } = store;
  const folder = useFolder();
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Restore object URLs from the folder after a reload.
  useEffect(() => {
    if (folder.status !== "ready") return;
    void rehydrate(store.get()).then((urls) => {
      if (Object.keys(urls).length)
        update((d) => d.media.forEach((m) => urls[m.id] && (m.url = urls[m.id])));
    });
  }, [folder.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = prod.nodes.find((n) => n.id === selectedId) ?? null;

  const syncFolder = async () => {
    setSyncing(true);
    const written = await mirrorAll(store.get());
    update((d) => d.media.forEach((m) => written[m.id] && (m.filePath = written[m.id])));
    setSyncing(false);
  };

  return (
    <div className="prod-app">
      <header className="prod-top">
        <span className="prod-top__brand">Magnific Production</span>
        <input
          className="prod-top__name"
          value={prod.name}
          onChange={(e) => update((d) => void (d.name = e.target.value))}
        />
        <div className="prod-top__spacer" />
        <button className="btn btn--ghost" onClick={() => setLevelsOpen(true)}>
          <IconLayersSubtract size={15} /> Niveles: {prod.levels.map((l) => l.name).join(" › ")}
        </button>
        <FolderButton status={folder.status} name={folder.name} syncing={syncing} onSync={syncFolder} />
        <input
          className="prod-top__user"
          placeholder="Tu nombre"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
      </header>

      <div className="prod-body">
        <aside className="prod-tree">
          <div className="prod-tree__head">
            <span>Estructura</span>
            <button className="icon-btn" title={`Nuevo ${prod.levels[0].name.toLowerCase()}`} onClick={() => {
              let id = "";
              update((d) => void (id = addNode(d, null, "").id));
              select(id);
            }}>
              <IconPlus size={15} />
            </button>
          </div>
          {childrenOf(prod, null).map((n) => (
            <TreeRow key={n.id} node={n} depth={0} />
          ))}
        </aside>

        <main className="prod-board">
          <Board />
        </main>

        <aside className={`prod-panel ${selected ? "" : "prod-panel--empty"}`}>
          {selected ? <NodePanel key={selected.id} node={selected} /> : (
            <p className="muted">Selecciona una escena o un plano para producir, cortar y revisar.</p>
          )}
        </aside>
      </div>

      {levelsOpen ? <LevelsModal onClose={() => setLevelsOpen(false)} /> : null}
    </div>
  );
}

function FolderButton(props: { status: string; name: string | null; syncing: boolean; onSync: () => void }) {
  if (props.status === "unsupported")
    return <span className="muted small" title="Usa Chrome o Edge para escribir en una carpeta">Carpeta: no disponible en este navegador</span>;
  if (props.status === "unlinked")
    return <button className="btn" onClick={() => void pickDirectory()}><IconFolder size={15} /> Elegir carpeta</button>;
  if (props.status === "needs-permission")
    return <button className="btn" onClick={() => void requestAccess()}><IconFolder size={15} /> Reconectar carpeta</button>;
  return (
    <button className="btn" onClick={props.onSync} disabled={props.syncing} title="Escribe estructura, media y metadatos en la carpeta">
      {props.syncing ? <span className="spin" /> : <IconRefresh size={15} />} {props.name}
    </button>
  );
}

function TreeRow({ node, depth }: { node: ProdNode; depth: number }) {
  const { prod, update, selectedId, select } = useProduction();
  const [open, setOpen] = useState(true);
  const kids = childrenOf(prod, node.id);
  const unit = isUnit(prod, node);
  const childLevel = prod.levels[node.level + 1];
  const prog = progressOf(prod, node);

  return (
    <>
      <div
        className={`tree-row ${selectedId === node.id ? "tree-row--on" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => select(node.id)}
      >
        {!unit ? (
          <button className={`tree-row__caret ${open ? "is-open" : ""}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <IconChevronRight size={13} />
          </button>
        ) : <span className="tree-row__caret" />}
        <span className={`dot dot--${node.status}`} />
        <span className="tree-row__code">{codeOf(prod, node)}</span>
        <span className="tree-row__title">{node.title}</span>
        {!unit && prog.total ? <span className="tree-row__prog">{prog.approved}/{prog.total}</span> : null}
        <span className="tree-row__acts" onClick={(e) => e.stopPropagation()}>
          {childLevel ? (
            <button className="icon-btn" title={`Añadir ${childLevel.name.toLowerCase()}`} onClick={() => {
              let id = "";
              update((d) => void (id = addNode(d, node.id, "").id));
              setOpen(true);
              select(id);
            }}><IconFolderPlus size={13} /></button>
          ) : null}
          <button className="icon-btn" title="Insertar después" onClick={() => {
            let id = "";
            update((d) => void (id = insertAfter(d, node.id, "").id));
            select(id);
          }}><IconPlus size={13} /></button>
          <button className="icon-btn" title="Subir" onClick={() => update((d) => moveNode(d, node.id, -1))}><IconArrowUp size={13} /></button>
          <button className="icon-btn" title="Bajar" onClick={() => update((d) => moveNode(d, node.id, 1))}><IconArrowDown size={13} /></button>
          <button className="icon-btn" title="Eliminar (con su contenido)" onClick={() => {
            if (confirm(`¿Eliminar ${codeOf(prod, node)} y todo su contenido?`)) {
              update((d) => removeNode(d, node.id));
              if (selectedId === node.id) select(null);
            }
          }}><IconTrash size={13} /></button>
        </span>
      </div>
      {open && kids.map((k) => <TreeRow key={k.id} node={k} depth={depth + 1} />)}
    </>
  );
}

/**
 * The production board: one lane per production-level node (scene by default)
 * with its own production card first (the scene's long clips / kept edit) and
 * then its unit cards (shots) in order.
 */
function Board() {
  const store = useProduction();
  const { prod, selectedId } = store;
  const rowLevel = Math.max(0, prod.levels.length - 2);
  const selected = prod.nodes.find((n) => n.id === selectedId);

  // Scope: the ancestor right above the lanes that contains the selection.
  const scopeLevel = rowLevel - 1;
  const scope =
    scopeLevel >= 0 && selected
      ? ancestors(prod, selected).find((a) => a.level === scopeLevel) ?? null
      : null;
  const rows = prod.nodes
    .filter((n) => n.level === rowLevel && (prod.levels.length > 1 ? true : n.parentId === null))
    .filter((n) => !scope || ancestors(prod, n).some((a) => a.id === scope.id))
    .sort((a, b) => pathKey(prod, a).localeCompare(pathKey(prod, b)));

  if (prod.levels.length === 1) {
    return <div className="lane"><div className="lane__cards">{rows.map((n) => <UnitCard key={n.id} node={n} />)}</div></div>;
  }

  return (
    <>
      <div className="board-head">
        <h2>{scope ? `${codeOf(prod, scope)} · ${scope.title || prod.levels[scope.level].name}` : "Toda la producción"}</h2>
        <span className="muted small">
          {rows.length} {prod.levels[rowLevel].name.toLowerCase()}s ·{" "}
          {rows.reduce((s, r) => s + childrenOf(prod, r.id).length, 0)} {prod.levels[rowLevel + 1].name.toLowerCase()}s
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Crea la estructura en el panel izquierdo para empezar.</p>
      ) : rows.map((r) => <Lane key={r.id} row={r} />)}
    </>
  );
}

const pathKey = (p: Production, n: ProdNode) =>
  ancestors(p, n).map((a) => String(a.number).padStart(6, "0")).join("/");

function Lane({ row }: { row: ProdNode }) {
  const store = useProduction();
  const { prod, update, select } = store;
  const units = childrenOf(prod, row.id);
  const unitLevel = prod.levels[row.level + 1];
  const pending = units.filter(
    (u) => !prod.media.some((m) => m.nodeId === u.id) && !prod.takes.some((t) => t.nodeId === u.id),
  );
  const [busy, setBusy] = useState(false);

  const batch = async () => {
    setBusy(true);
    await generateBatch(
      store,
      pending.map((u) => ({
        nodeId: u.id,
        kind: "image" as const,
        prompt: [row.title, row.notes, u.title, u.notes].filter(Boolean).join(". ") || `${codeOf(prod, u)}`,
        model: "auto",
        durationSec: 0,
      })),
    );
    setBusy(false);
  };

  return (
    <section className="lane">
      <div className="lane__head">
        <span className="lane__code">{ancestors(prod, row).map((a) => codeOf(prod, a)).join(" / ")}</span>
        <span className="lane__title">{row.title}</span>
        <StatusPill status={row.status} />
        <span className="muted small">{nodeDuration(prod, row)} s</span>
        <div className="prod-top__spacer" />
        {pending.length && unitLevel.canGenerate ? (
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={batch} title="Genera un keyframe para cada plano vacío (sin media ni tomas), con su título y notas">
            {busy ? <span className="spin" /> : <IconWand size={14} />} Keyframes pendientes ({pending.length})
          </button>
        ) : null}
      </div>
      <div className="lane__cards">
        <SceneCard node={row} />
        {units.map((u) => <UnitCard key={u.id} node={u} />)}
        <button className="card card--add" onClick={() => {
          let id = "";
          update((d) => void (id = addNode(d, row.id, "").id));
          select(id);
        }}>
          <IconPlus size={18} /> {unitLevel.name}
        </button>
      </div>
    </section>
  );
}

function SceneCard({ node }: { node: ProdNode }) {
  const { prod, selectedId, select } = useProduction();
  const cover = coverOf(prod, node);
  const own = prod.media.filter((m) => m.nodeId === node.id);
  const role = roleOf(prod, node);
  return (
    <div className={`card card--scene ${selectedId === node.id ? "card--on" : ""}`} onClick={() => select(node.id)}>
      <Thumb {...cover} />
      <div className="card__meta">
        <span className="card__code">{codeOf(prod, node)}</span>
        <span className="muted small">{role === "production" ? "Producción de escena" : "Montaje"}</span>
      </div>
      <div className="card__foot muted small">
        <span>{own.length} clip{own.length === 1 ? "" : "s"}</span>
        {own.some((m) => m.status === "queued" || m.status === "rendering") ? <span className="spin" /> : null}
      </div>
    </div>
  );
}

function UnitCard({ node }: { node: ProdNode }) {
  const { prod, selectedId, select } = useProduction();
  const cover = coverOf(prod, node);
  const versions = prod.media.filter((m) => m.nodeId === node.id).length;
  const takes = prod.takes.filter((t) => t.nodeId === node.id).length;
  const comments = prod.comments.filter((c) => c.nodeId === node.id).length;
  const rendering = prod.media.some((m) => m.nodeId === node.id && (m.status === "queued" || m.status === "rendering"));
  return (
    <div className={`card ${selectedId === node.id ? "card--on" : ""}`} onClick={() => select(node.id)}>
      <Thumb {...cover} />
      <div className="card__meta">
        <span className="card__code">{codeOf(prod, node)}</span>
        <StatusPill status={node.status} />
      </div>
      <div className="card__title">{node.title || <span className="muted">Sin título</span>}</div>
      <div className="card__foot muted small">
        <span title="Versiones generadas aquí">{versions} v</span>
        <span title="Tomas colocadas">{takes} tomas</span>
        <span>{nodeDuration(prod, node)} s</span>
        {comments ? <span><IconMessage size={11} /> {comments}</span> : null}
        {rendering ? <span className="spin" /> : null}
        {node.assignee ? <span className="avatar" title={node.assignee}>{node.assignee.slice(0, 1).toUpperCase()}</span> : null}
      </div>
    </div>
  );
}
