import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { GateButton } from "@/components/GateButton";

export function ScriptPage() {
  const { project, update } = useStore();
  const block = useActiveBlock();
  const gate = block.getGateState();

  if (gate === "locked") {
    return <LockedNotice />;
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>📝 Guion</h1>
          <p className="muted">Guion profesional, escena a escena.</p>
        </div>
        <GateButton
          state={gate}
          label="Guion validado → generar storyboard"
          onValidate={block.validate}
        />
      </header>

      <ContextualActions actions={block.getActions()} />

      <section className="script">
        {project.scenes.map((s) => (
          <article className="scene" key={s.id}>
            <div className="scene__head">
              <input
                className="scene__heading"
                value={s.heading}
                onChange={(e) =>
                  update((d) => {
                    d.scenes.find((x) => x.id === s.id)!.heading =
                      e.target.value;
                  })
                }
              />
              <span className="scene__dur">~{s.durationSec}s</span>
            </div>
            <textarea
              className="scene__action"
              value={s.action}
              onChange={(e) =>
                update((d) => {
                  d.scenes.find((x) => x.id === s.id)!.action = e.target.value;
                })
              }
            />
            <textarea
              className="scene__dialogue"
              value={s.dialogue}
              onChange={(e) =>
                update((d) => {
                  d.scenes.find((x) => x.id === s.id)!.dialogue =
                    e.target.value;
                })
              }
            />
          </article>
        ))}
      </section>
    </div>
  );
}

function LockedNotice() {
  return (
    <div className="page locked-page">
      <h1>🔒 Guion</h1>
      <p className="muted">
        Esta fase se desbloquea cuando validas la Historia.
      </p>
    </div>
  );
}
