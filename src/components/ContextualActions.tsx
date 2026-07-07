import { useState } from "react";
import { IconBolt } from "@tabler/icons-react";
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
  // Validation is handled by the gate button; the primary action lives in the
  // page lead row (next to the description) — neither shows here.
  const visible = actions.filter((a) => !a.id.startsWith("validate") && !a.primary);
  if (visible.length === 0) return null;

  return (
    <div className="actions">
      {visible.map((a) => (
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
          {busy === a.id ? (
            <>
              <span className="spin" /> Generando…
            </>
          ) : (
            <>
              {a.label}
              {a.generative ? (
                <span className="action__gen">
                  <IconBolt size={15} />
                </span>
              ) : null}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
