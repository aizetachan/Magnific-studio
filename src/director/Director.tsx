import { useEffect, useState } from "react";
import { IconArmchair, IconMessage, IconSparkles, IconX } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { resolveIntent } from "./orchestrator";
import { askClaude } from "./ask";
import { editStyle, generateMoreScenes } from "./generate";
import { runShotGeneration } from "@/blocks/runner";
import { uid } from "@/state/seed";
import type { Project } from "@/types/project";
import type { ClaudeMessage } from "./AnthropicClient";

/** Lets the Director APPLY agreed edits to project fields from free conversation. */
const APPLY_PROTOCOL = [
  "Puedes APLICAR cambios concretos a campos del proyecto cuando el usuario los confirme o pida",
  "(por ejemplo, al validar una opción que has propuesto).",
  "Para aplicar, TERMINA tu respuesta con UNA sola línea EXACTA y nada después:",
  '@@APPLY {"field":"style|tone|logline","value":"<texto nuevo completo>"}',
  "donde 'style' = estilo visual global, 'tone' = tono/género/referencias, 'logline' = logline.",
  "Incluye @@APPLY SOLO cuando haya un cambio acordado, y no menciones el JSON en la prosa.",
].join("\n");

/** Detect "genera imagen/vídeo para la escena N plano M" → the target shot. */
function parseShotGen(q: string, project: Project) {
  const s = q.toLowerCase();
  if (!/(genera|crea|regenera|haz|nuev|produc)/.test(s)) return null;
  const video = /v[ií]deo/.test(s);
  const image = /imagen|keyframe|foto|frame/.test(s);
  if (!video && !image) return null;
  const esc = s.match(/escena\s*(\d+)/);
  if (!esc) return null;
  const scene = project.scenes.find((x) => x.number === parseInt(esc[1], 10));
  if (!scene) return null;
  const shots = project.shots
    .filter((x) => x.sceneId === scene.id)
    .sort((a, b) => a.order - b.order);
  const plano = s.match(/plano\s*(\d+)/);
  const shot = plano ? shots.find((x) => x.order === parseInt(plano[1], 10)) : shots[0];
  if (!shot) return null;
  return {
    shotId: shot.id,
    kind: (video ? "video" : "image") as "video" | "image",
    sceneNum: scene.number,
    order: shot.order,
  };
}

const NUM_WORDS: Record<string, number> = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
};

/** Detect "añade/genera N escenas (más)" → number of scenes to add, else null. */
function parseSceneRequest(q: string): number | null {
  const s = q.toLowerCase();
  if (!/escena/.test(s)) return null;
  if (!/(añad|agreg|genera|crea|suma|m[aá]s|otra|nueva)/.test(s)) return null;
  const digit = s.match(/(\d+)\s*escena/);
  if (digit) return Math.min(10, Math.max(1, parseInt(digit[1], 10)));
  for (const [w, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(s)) return n;
  }
  return 1;
}

/**
 * Claude's presence (§3): a thin permanent Director bar at the bottom
 * (command/spotlight) that expands on use, plus an on-demand Director panel on
 * the right for deep conversation. Neither steals space permanently.
 *
 * - Bar: fast, page-aware orchestration. Detects intent and fires the right
 *   block action within the active scope, or softly redirects (§4).
 * - Panel: real /v1/messages conversation (when an API key is set), with the
 *   page scope injected into the system prompt on every call.
 */
export function Director() {
  const store = useStore();
  const block = useActiveBlock();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [redirected, setRedirected] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(true);
  const [replySticky, setReplySticky] = useState(false);
  const [convo, setConvo] = useState<ClaudeMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);

  // Auto-dismiss QUICK action toasts after 5s. Conversation replies are "sticky"
  // (the full thread is logged in the panel; the toast stays until dismissed).
  useEffect(() => {
    if (!reply || running || replySticky) return;
    const t = setTimeout(() => setReply(null), 5000);
    return () => clearTimeout(t);
  }, [reply, running, replySticky]);

  /** Parse + apply a trailing @@APPLY directive; returns the clean visible text. */
  const applyDirective = (answer: string): string => {
    const m = answer.match(/@@APPLY\s*(\{[\s\S]*\})\s*$/);
    if (!m) return answer;
    const clean = answer.replace(/@@APPLY[\s\S]*$/, "").trim();
    let parsed: { field?: string; value?: string };
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return clean;
    }
    const field = parsed.field;
    const value = String(parsed.value ?? "");
    if (!value || !["style", "tone", "logline"].includes(field ?? "")) return clean;
    store.update((d) => {
      if (field === "tone") d.story.tone = value;
      else if (field === "logline") d.story.logline = value;
      else if (field === "style") {
        d.library = d.library ?? [];
        let a = d.styleId ? d.library.find((x) => x.id === d.styleId) : d.library.find((x) => x.type === "style");
        if (!a) {
          a = { id: uid("asset"), type: "style", name: "Estilo del corto", prompt: "", createdAt: Date.now() };
          d.library.push(a);
          d.styleId = a.id;
        }
        a.prompt = value;
      }
    });
    window.dispatchEvent(new CustomEvent("ms:flash", { detail: { target: field } }));
    return clean;
  };

  /**
   * Multi-turn conversation. The full thread is logged in the side panel (open
   * with the 💬 icon to consult it); when the panel is closed the latest reply
   * shows as a sticky pink toast. The Director can APPLY agreed edits in place.
   */
  const converse = async (q: string) => {
    const ctx = block.getPageContext();
    const next: ClaudeMessage[] = [...convo, { role: "user", content: q }];
    setConvo(next);
    setThinking(true);
    if (!panelOpen) {
      setReplySticky(true);
      setReply("Pensando…");
    }
    try {
      const raw = await askClaude(
        store,
        ctx,
        next,
        () => offlineReply(q, ctx.phaseLabel, ctx.implicitReferent),
        1024,
        APPLY_PROTOCOL,
      );
      const clean = applyDirective(raw);
      setConvo([...next, { role: "assistant", content: clean }]);
      if (!panelOpen) {
        setReplySticky(true);
        setRedirected(false);
        setReply(clean);
      } else {
        setReply(null);
      }
    } finally {
      setThinking(false);
    }
  };

  const runCommand = async () => {
    const q = text.trim();
    if (!q || running) return;
    setText("");
    setRedirected(false);
    setReplySticky(false); // quick action toasts auto-dismiss again
    const ctx = block.getPageContext();

    // 1) Natural language: generate a keyframe/video for a specific shot.
    const shotReq = parseShotGen(q, store.project);
    if (shotReq) {
      setRunning(true);
      const what = shotReq.kind === "video" ? "vídeo" : "imagen";
      setReply(`Generando ${what} de Escena ${shotReq.sceneNum} · Plano ${shotReq.order}…`);
      try {
        await runShotGeneration(store, {
          shotId: shotReq.shotId,
          field: shotReq.kind === "video" ? "video" : "keyframe",
          kind: shotReq.kind,
          phase: shotReq.kind === "video" ? "production" : "storyboard",
          scopeLabel: `Escena ${shotReq.sceneNum} · Plano ${shotReq.order}`,
        });
        setReply(
          `Listo: Escena ${shotReq.sceneNum} · Plano ${shotReq.order}. Lo verás en ${shotReq.kind === "video" ? "Producción" : "Storyboard"}.`,
        );
      } catch (e) {
        setReply(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
      return;
    }

    // 2) Natural language: add N scenes.
    const sceneN = parseSceneRequest(q);
    if (sceneN) {
      setRunning(true);
      setReply(`Generando ${sceneN} escena${sceneN > 1 ? "s" : ""}…`);
      try {
        await generateMoreScenes(store, sceneN);
        setReply(`Listo: ${sceneN} escena${sceneN > 1 ? "s" : ""} añadida${sceneN > 1 ? "s" : ""}.`);
      } catch (e) {
        setReply(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
      return;
    }

    // 2.5) Direct edit: adjust the global visual style in place + flash it pink.
    const ql = q.toLowerCase();
    if (/\bestilo\b/.test(ql) && /(ajust|cambi|modific|aplica|haz|pon|m[aá]s)/.test(ql)) {
      setRunning(true);
      setReply("Ajustando el estilo visual…");
      try {
        await editStyle(store, q);
        setReply("Estilo visual actualizado.");
        window.dispatchEvent(new CustomEvent("ms:flash", { detail: { target: "style" } }));
      } catch (e) {
        setReply(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
      return;
    }

    // 2) Keyword intent → run the matching block action.
    const result = resolveIntent(q, ctx, block.getActions());
    if (result.action) {
      setReply(result.reply);
      setRedirected(result.redirected);
      setRunning(true);
      try {
        await result.action.run(result.arg);
      } finally {
        setRunning(false);
      }
      return;
    }

    // 3) No action matched: it's a conversation → persistent inline thread.
    await converse(q);
  };

  const ctx = block.getPageContext();

  return (
    <>
      {panelOpen ? (
        <DirectorPanel
          phaseLabel={ctx.phaseLabel}
          scope={ctx.implicitReferent}
          convo={convo}
          thinking={thinking}
          onSend={converse}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      <div className="director">
        {reply ? (
          <div className={`director__reply ${redirected ? "is-redirect" : ""} ${replySticky ? "is-sticky" : ""}`}>
            <span className="director__avatar">
              <IconSparkles size={16} />
            </span>
            <span className="director__reply-text">{reply}</span>
            {replySticky && convo.length > 0 ? (
              <button className="mini" title="Ver la conversación completa" onClick={() => { setPanelOpen(true); setReply(null); }}>
                Ver chat
              </button>
            ) : null}
            <button className="director__dismiss" onClick={() => setReply(null)}>
              <IconX size={15} />
            </button>
          </div>
        ) : null}
        <div className={`director__bar ${barOpen ? "" : "director__bar--collapsed"}`}>
          <span className="director__scope" title="Scope de página activo">
            {ctx.phaseLabel}
          </span>
          <input
            placeholder={`Pide algo al Director… (scope: ${ctx.implicitReferent})`}
            value={text}
            disabled={running || thinking}
            tabIndex={barOpen ? 0 : -1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runCommand();
            }}
          />
          <button
            className="director__go"
            disabled={running || thinking}
            onClick={() => void runCommand()}
          >
            {running || thinking ? "…" : "Enviar"}
          </button>
          <button
            className="director__panel-toggle"
            onClick={() => setPanelOpen((v) => !v)}
            title="Panel de Director (conversación profunda)"
          >
            <IconMessage size={16} />
          </button>
          <button
            className="director__chair"
            onClick={() => setBarOpen((v) => !v)}
            title={barOpen ? "Cerrar el Director" : "Abrir el Director"}
            aria-label={barOpen ? "Cerrar el Director" : "Abrir el Director"}
          >
            <IconArmchair size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

function DirectorPanel({
  phaseLabel,
  scope,
  convo,
  thinking,
  onSend,
  onClose,
}: {
  phaseLabel: string;
  scope: string;
  convo: ClaudeMessage[];
  thinking: boolean;
  onSend: (q: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <aside className="dpanel">
      <header className="dpanel__head">
        <div>
          <strong>Director</strong>
          <div className="muted small">
            {phaseLabel} · scope: {scope}
          </div>
        </div>
        <button onClick={onClose}><IconX size={16} /></button>
      </header>
      <div className="dpanel__log">
        {convo.length === 0 ? (
          <p className="muted small">
            Conversación profunda con contexto de página inyectado. Prueba a
            discutir el tono, un arco, o pedir algo fuera de fase para ver cómo
            redirijo.
          </p>
        ) : (
          convo.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>
              {m.content}
            </div>
          ))
        )}
        {thinking ? <div className="msg msg--assistant">…</div> : null}
      </div>
      <div className="dpanel__input">
        <textarea
          value={draft}
          placeholder="Escribe al Director…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim()) {
                onSend(draft.trim());
                setDraft("");
              }
            }
          }}
        />
      </div>
    </aside>
  );
}

/** Heuristic reply when no API key is connected, so the panel stays usable. */
function offlineReply(q: string, phaseLabel: string, scope: string): string {
  const lower = q.toLowerCase();
  if (/(v[íi]deo|render|prod[úu]ce)/.test(lower) && phaseLabel === "Historia") {
    return "Eso es de la fase de Producción; estás en Historia. Primero cerramos historia, guion y storyboard.";
  }
  return `(${phaseLabel}) Trabajando sobre ${scope}. Conecta tu API key en Ajustes para una conversación completa; ahora respondo en modo offline.`;
}
