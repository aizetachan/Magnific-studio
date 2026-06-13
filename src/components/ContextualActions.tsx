import { useState } from "react";
import type { ActionArg, BlockAction } from "@/types/pipeline";

/**
 * Smart contextual buttons — most work happens here, without typing in a chat
 * (§3.2). Generative actions show a credit preflight before running.
 */
export function ContextualActions({
  actions,
  arg,
}: {
  actions: BlockAction[];
  arg?: ActionArg;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (actions.length === 0) return null;

  return (
    <div className="actions">
      {actions.map((a) => (
        <button
          key={a.id}
          className={`action ${a.generative ? "action--gen" : ""}`}
          disabled={!a.enabled || busy === a.id}
          title={a.hint}
          onClick={async () => {
            setBusy(a.id);
            try {
              await a.run(arg);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === a.id ? "…" : a.label}
          {a.generative ? <span className="action__gen">⚡</span> : null}
        </button>
      ))}
    </div>
  );
}
