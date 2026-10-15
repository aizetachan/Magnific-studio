import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconCut, IconPhoto, IconPlayerPlay, IconSend, IconTrash, IconVideo, IconWand, IconX } from "@tabler/icons-react";
import { useModels } from "@/generation/models";
import {
  addNode,
  addTake,
  ancestors,
  childrenOf,
  codeOf,
  isUnit,
  newId,
  nodeDuration,
  roleOf,
  round,
  segmentsFromCuts,
  STATUS_LABEL,
  takeDuration,
  versionTag,
  type Media,
  type MediaKind,
  type NodeStatus,
  type ProdNode,
} from "./model";
import { useProduction } from "./store";
import { generateMedia } from "./generate";
import { mirrorMetadata } from "./mirror";
import { isPlayable, Thumb } from "./ProductionApp";

const KEEP = "__keep__";
const NEW = "__new__";

export function NodePanel({ node }: { node: ProdNode }) {
  const store = useProduction();
  const { prod, update, select } = store;
  const level = prod.levels[node.level];
  const unit = isUnit(prod, node);
  const role = roleOf(prod, node);
  const own = prod.media.filter((m) => m.nodeId === node.id).sort((a, b) => b.createdAt - a.createdAt);
  const [activeMediaId, setActiveMediaId] = useState<string | null>(own[0]?.id ?? null);
  const active = prod.media.find((m) => m.id === activeMediaId) ?? own[0] ?? null;

  // Persist metadata (status, takes, comments) to the folder, debounced.
  useEffect(() => {
    const t = setTimeout(() => void mirrorMetadata(store.get()), 800);
    return () => clearTimeout(t);
  }, [prod.takes, prod.comments, prod.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn: (n: ProdNode) => void) =>
    update((d) => {
      const n = d.nodes.find((x) => x.id === node.id);
      if (n) fn(n);
    });

  return (
    <div className="np">
      <div className="np__crumbs muted small">
        {ancestors(prod, node).map((a, i, arr) => (
          <span key={a.id}>
            <button className="link" onClick={() => select(a.id)}>{codeOf(prod, a)}</button>
            {i < arr.length - 1 ? " / " : ""}
          </span>
        ))}
        <span> · {level.name}{role === "production" ? " (punto de producción)" : role === "group" ? " (montaje)" : ""}</span>
      </div>
      <input
        className="np__title"
        placeholder={`Título del ${level.name.toLowerCase()}`}
        value={node.title}
        onChange={(e) => set((n) => (n.title = e.target.value))}
      />
      <div className="np__row">
        <select value={node.status} onChange={(e) => set((n) => (n.status = e.target.value as NodeStatus))}>
          {(Object.keys(STATUS_LABEL) as NodeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input
          placeholder="Responsable"
          value={node.assignee ?? ""}
          onChange={(e) => set((n) => (n.assignee = e.target.value || undefined))}
        />
        <span className="muted small">{nodeDuration(prod, node)} s</span>
      </div>
      <textarea
        className="np__notes"
        placeholder="Descripción / acción / notas de dirección (se usan como base del prompt)"
        value={node.notes}
        onChange={(e) => set((n) => (n.notes = e.target.value))}
      />

      {level.canGenerate ? (
        <GenerateBox node={node} onCreated={() => setActiveMediaId(null)} />
      ) : (
        <p className="muted small">En este nivel no se genera: aquí se montan y conservan las tomas de sus {prod.levels[node.level + 1]?.name.toLowerCase()}s.</p>
      )}

      {own.length ? (
        <section className="np__sec">
          <h4>Versiones generadas aquí</h4>
          <div className="versions">
            {own.map((m) => (
              <button key={m.id} className={`version ${m.id === active?.id ? "version--on" : ""}`} onClick={() => setActiveMediaId(m.id)}>
                <Thumb media={m} />
                <span className="version__tag">
                  {m.kind === "video" ? <IconVideo size={11} /> : <IconPhoto size={11} />} {versionTag(m.version)}
                  {m.kind === "video" ? ` · ${m.durationSec}s` : ""}
                </span>
                {m.status === "failed" ? <span className="version__err" title={m.error}>Error</span> : null}
                {m.status === "queued" || m.status === "rendering" ? <span className="version__prog">{m.progress}%</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {active && active.nodeId === node.id ? (
        active.status === "ready" ? (
          <Cutter key={active.id} node={node} media={active} />
        ) : active.status === "failed" ? (
          <p className="bad small">{active.error}</p>
        ) : null
      ) : null}

      <TakesHere node={node} />
      {!unit ? <ChildrenSummary node={node} /> : null}
      <Comments node={node} media={active?.nodeId === node.id ? active : null} />
    </div>
  );
}

function GenerateBox({ node, onCreated }: { node: ProdNode; onCreated: () => void }) {
  const store = useProduction();
  const { prod } = store;
  const level = prod.levels[node.level];
  const [kind, setKind] = useState<MediaKind>(isUnit(prod, node) ? "image" : "video");
  const models = useModels(kind);
  const [model, setModel] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(Math.min(level.maxVideoSec, isUnit(prod, node) ? 5 : 30));
  const images = prod.media.filter(
    (m) => m.kind === "image" && m.status === "ready" && (m.nodeId === node.id || m.nodeId === node.parentId),
  );
  const [sourceId, setSourceId] = useState("");

  const basePrompt = () =>
    prompt.trim() ||
    ancestors(prod, node)
      .map((a) => [a.title, a.notes].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(". ");

  const run = () => {
    const p = basePrompt();
    if (!p) return;
    void generateMedia(store, {
      nodeId: node.id,
      kind,
      prompt: p,
      model,
      durationSec: duration,
      sourceMediaId: kind === "video" && sourceId ? sourceId : undefined,
    });
    onCreated();
  };

  return (
    <section className="np__sec gen">
      <div className="seg">
        <button className={kind === "image" ? "on" : ""} onClick={() => setKind("image")}><IconPhoto size={14} /> Imagen</button>
        <button className={kind === "video" ? "on" : ""} onClick={() => setKind("video")}><IconVideo size={14} /> Vídeo</button>
      </div>
      <textarea
        placeholder={`Prompt (vacío = título y notas de ${ancestors(prod, node).map((a) => codeOf(prod, a)).join(" › ")})`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="np__row">
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
        </select>
        {kind === "video" ? (
          <>
            <label className="small dur">
              <input type="range" min={1} max={level.maxVideoSec} value={duration} onChange={(e) => setDuration(+e.target.value)} />
              {duration}s
            </label>
          </>
        ) : null}
      </div>
      {kind === "video" && images.length ? (
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">Sin imagen de partida</option>
          {images.map((m) => {
            const n = prod.nodes.find((x) => x.id === m.nodeId)!;
            return <option key={m.id} value={m.id}>Desde {codeOf(prod, n)} img {versionTag(m.version)}</option>;
          })}
        </select>
      ) : null}
      <button className="btn btn--create" onClick={run}><IconWand size={15} /> Generar {kind === "video" ? `${duration}s de vídeo` : "imagen"}</button>
    </section>
  );
}

/**
 * Viewer + non-destructive cutter. Cut points split the media into segments;
 * each segment goes to a child folder (shot), stays in this node, or creates a
 * new child. The original is never modified.
 */
function Cutter({ node, media }: { node: ProdNode; media: Media }) {
  const store = useProduction();
  const { prod, update, user } = store;
  const video = useRef<HTMLVideoElement>(null);
  const [head, setHead] = useState(0);
  const [cuts, setCuts] = useState<number[]>([]);
  const isVideo = media.kind === "video";
  const dur = isVideo ? media.durationSec : 0;
  const segments = useMemo(() => (isVideo ? segmentsFromCuts(dur, cuts) : []), [isVideo, dur, cuts]);
  const kids = childrenOf(prod, node.id);
  const childLevel = prod.levels[node.level + 1];
  const [dest, setDest] = useState<string[]>([]);
  const destOf = (i: number) => dest[i] ?? (kids[i]?.id ?? (kids.length ? NEW : KEEP));

  const seek = (t: number) => {
    const v = round(Math.max(0, Math.min(dur, t)));
    setHead(v);
    if (video.current) video.current.currentTime = v;
  };

  const place = (indexes: number[]) => {
    update((d) => {
      for (const i of indexes) {
        const seg = segments[i] ?? { inSec: 0, outSec: dur };
        let target = destOf(i);
        if (target === NEW) target = addNode(d, node.id, `Corte ${round(seg.inSec)}–${round(seg.outSec)}s`).id;
        if (target === KEEP) target = node.id;
        addTake(d, { nodeId: target, mediaId: media.id, inSec: seg.inSec, outSec: seg.outSec, by: user || "Anónimo" });
      }
    });
    setCuts([]);
    setDest([]);
  };

  return (
    <section className="np__sec cutter">
      <div className="viewer">
        {isPlayable(media) ? (
          <video ref={video} src={media.url} controls onTimeUpdate={(e) => setHead(round(e.currentTarget.currentTime))} />
        ) : (
          <img src={media.url} alt="" />
        )}
      </div>
      <p className="muted small prompt-line" title={media.prompt}>{media.prompt}</p>

      {isVideo ? (
        <>
          <div className="timeline" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * dur);
          }}>
            {segments.map((s, i) => (
              <div key={i} className={`timeline__seg seg-c${i % 6}`} style={{ left: `${(s.inSec / dur) * 100}%`, width: `${((s.outSec - s.inSec) / dur) * 100}%` }}>
                {i + 1}
              </div>
            ))}
            {cuts.map((c) => (
              <button key={c} className="timeline__cut" style={{ left: `${(c / dur) * 100}%` }} title={`Quitar corte ${c}s`}
                onClick={(e) => { e.stopPropagation(); setCuts(cuts.filter((x) => x !== c)); }} />
            ))}
            <div className="timeline__head" style={{ left: `${(head / dur) * 100}%` }} />
          </div>
          <div className="np__row">
            <input type="range" min={0} max={dur} step={0.1} value={head} onChange={(e) => seek(+e.target.value)} />
            <span className="small mono">{head.toFixed(1)}s</span>
            <button className="btn btn--sm" onClick={() => setCuts([...cuts, head])} disabled={head <= 0 || head >= dur}>
              <IconCut size={14} /> Cortar aquí
            </button>
          </div>
        </>
      ) : null}

      <div className="segments">
        {(isVideo ? segments : [{ inSec: 0, outSec: 0 }]).map((s, i) => (
          <div key={i} className="segment">
            <span className={`segment__n seg-c${i % 6}`}>{i + 1}</span>
            {isVideo ? (
              <button className="link small mono" onClick={() => seek(s.inSec)} title="Ir al inicio">
                <IconPlayerPlay size={11} /> {s.inSec}–{s.outSec}s ({round(s.outSec - s.inSec)}s)
              </button>
            ) : <span className="small">Imagen completa</span>}
            <select value={destOf(i)} onChange={(e) => { const n = [...dest]; n[i] = e.target.value; setDest(n); }}>
              <option value={KEEP}>{isUnit(prod, node) ? `Toma de ${codeOf(prod, node)}` : `Mantener en ${codeOf(prod, node)}`}</option>
              {kids.map((k) => <option key={k.id} value={k.id}>→ {codeOf(prod, k)} {k.title}</option>)}
              {childLevel ? <option value={NEW}>→ Nuevo {childLevel.name.toLowerCase()}</option> : null}
            </select>
            <button className="icon-btn" title="Colocar este tramo" onClick={() => place([i])}><IconCheck size={14} /></button>
          </div>
        ))}
      </div>
      {isVideo && segments.length > 1 ? (
        <button className="btn" onClick={() => place(segments.map((_, i) => i))}>
          <IconCut size={14} /> Colocar los {segments.length} tramos
        </button>
      ) : null}
    </section>
  );
}

function TakesHere({ node }: { node: ProdNode }) {
  const { prod, update } = useProduction();
  const takes = prod.takes.filter((t) => t.nodeId === node.id);
  if (!takes.length) return null;
  return (
    <section className="np__sec">
      <h4>Tomas en {codeOf(prod, node)}</h4>
      {takes.map((t) => {
        const m = prod.media.find((x) => x.id === t.mediaId);
        const from = m ? prod.nodes.find((n) => n.id === m.nodeId) : undefined;
        const on = node.selectedTakeId === t.id;
        return (
          <div key={t.id} className={`take ${on ? "take--on" : ""}`}>
            <Thumb media={m} inSec={t.inSec} />
            <div className="take__meta small">
              <div>{from ? `${codeOf(prod, from)} ${m ? versionTag(m.version) : ""}` : "—"} · {m?.kind === "video" ? `${t.inSec}–${t.outSec}s (${takeDuration(t)}s)` : "imagen"}</div>
              <div className="muted">{t.createdBy}</div>
            </div>
            <button className={`btn btn--sm ${on ? "btn--on" : ""}`} onClick={() => update((d) => {
              const n = d.nodes.find((x) => x.id === node.id)!;
              n.selectedTakeId = t.id;
            })}>{on ? "Elegida" : "Elegir"}</button>
            <button className="icon-btn" title="Quitar toma (el original se conserva)" onClick={() => update((d) => {
              d.takes = d.takes.filter((x) => x.id !== t.id);
              const n = d.nodes.find((x) => x.id === node.id)!;
              if (n.selectedTakeId === t.id) n.selectedTakeId = d.takes.find((x) => x.nodeId === node.id)?.id;
            })}><IconTrash size={13} /></button>
          </div>
        );
      })}
    </section>
  );
}

function ChildrenSummary({ node }: { node: ProdNode }) {
  const { prod, select } = useProduction();
  const kids = childrenOf(prod, node.id);
  if (!kids.length) return null;
  return (
    <section className="np__sec">
      <h4>{prod.levels[node.level + 1].name}s</h4>
      <div className="kids">
        {kids.map((k) => (
          <button key={k.id} className="kid" onClick={() => select(k.id)}>
            <span className={`dot dot--${k.status}`} /> {codeOf(prod, k)} <span className="muted">{k.title}</span>
            <span className="muted small"> {nodeDuration(prod, k)}s</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Comments({ node, media }: { node: ProdNode; media: Media | null }) {
  const { prod, update, user } = useProduction();
  const [text, setText] = useState("");
  const list = prod.comments.filter((c) => c.nodeId === node.id).sort((a, b) => a.createdAt - b.createdAt);
  const send = () => {
    if (!text.trim()) return;
    update((d) =>
      void d.comments.push({
        id: newId("c"),
        nodeId: node.id,
        mediaId: media?.id,
        author: user || "Anónimo",
        text: text.trim(),
        createdAt: Date.now(),
      }),
    );
    setText("");
  };
  return (
    <section className="np__sec">
      <h4>Comentarios</h4>
      {list.map((c) => {
        const m = c.mediaId ? prod.media.find((x) => x.id === c.mediaId) : undefined;
        return (
          <div key={c.id} className="comment">
            <span className="avatar">{c.author.slice(0, 1).toUpperCase()}</span>
            <div>
              <div className="small"><b>{c.author}</b> <span className="muted">{new Date(c.createdAt).toLocaleString()}{m ? ` · ${versionTag(m.version)}` : ""}</span></div>
              <div>{c.text}</div>
            </div>
            <button className="icon-btn" onClick={() => update((d) => void (d.comments = d.comments.filter((x) => x.id !== c.id)))}><IconX size={12} /></button>
          </div>
        );
      })}
      <div className="np__row">
        <input
          placeholder={media ? `Comentar ${versionTag(media.version)}…` : "Comentar…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="icon-btn" onClick={send}><IconSend size={14} /></button>
      </div>
    </section>
  );
}
