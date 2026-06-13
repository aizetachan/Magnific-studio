import { useState } from "react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { resolveIntent } from "./orchestrator";
import { askClaude } from "./ask";
import type { ClaudeMessage } from "./AnthropicClient";

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
  const [convo, setConvo] = useState<ClaudeMessage[]>([]);
  const [thinking, setThinking] = useState(false);

  const runCommand = async () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    const ctx = block.getPageContext();
    const actions = block.getActions();
    const result = resolveIntent(q, ctx, actions);
    setReply(result.reply);
    setRedirected(result.redirected);
    // Meter the intent routing as a (cheap) Claude call.
    store.meter({
      phase: ctx.phase,
      scope: ctx.implicitReferent,
      kind: "claude",
      label: "director · intent",
      inputTokens: Math.ceil(q.length / 4) + 120,
      outputTokens: 40,
      claudeCostUsd: store.project.settings.anthropicApiKey ? 0.0015 : 0,
    });
    if (result.action) {
      await result.action.run(result.arg);
    }
  };

  const sendConversation = async (q: string) => {
    const ctx = block.getPageContext();
    const next: ClaudeMessage[] = [...convo, { role: "user", content: q }];
    setConvo(next);
    setThinking(true);
    try {
      const answer = await askClaude(store, ctx, next, () =>
        offlineReply(q, ctx.phaseLabel, ctx.implicitReferent),
      );
      setConvo([...next, { role: "assistant", content: answer }]);
    } finally {
      setThinking(false);
    }
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
          onSend={sendConversation}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      <div className="director">
        {reply ? (
          <div className={`director__reply ${redirected ? "is-redirect" : ""}`}>
            <span className="director__avatar">◐</span>
            <span>{reply}</span>
            <button className="director__dismiss" onClick={() => setReply(null)}>
              ✕
            </button>
          </div>
        ) : null}
        <div className="director__bar">
          <span className="director__scope" title="Scope de página activo">
            {ctx.phaseLabel}
          </span>
          <input
            placeholder={`Pide algo al Director… (scope: ${ctx.implicitReferent})`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runCommand();
            }}
          />
          <button className="director__go" onClick={() => void runCommand()}>
            Enviar
          </button>
          <button
            className="director__panel-toggle"
            onClick={() => setPanelOpen((v) => !v)}
            title="Panel de Director (conversación profunda)"
          >
            💬
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
        <button onClick={onClose}>✕</button>
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
