import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { GateButton } from "@/components/GateButton";
import { JobBadge } from "@/components/JobBadge";
import { runShotGeneration } from "../runner";
import type { Shot } from "@/types/project";

export function StoryboardPage() {
  const store = useStore();
  const { project, update, generation } = store;
  const block = useActiveBlock();
  const gate = block.getGateState();

  if (gate === "locked") {
    return (
      <div className="page locked-page">
        <h1>🔒 Storyboard</h1>
        <p className="muted">Se desbloquea cuando validas el Guion.</p>
      </div>
    );
  }

  const sceneOf = (id: string) => project.scenes.find((s) => s.id === id)!;
  const grouped = [...project.scenes]
    .sort((a, b) => a.number - b.number)
    .map((sc) => ({
      scene: sc,
      shots: project.shots
        .filter((s) => s.sceneId === sc.id)
        .sort((a, b) => a.order - b.order),
    }));

  const regen = (shot: Shot) =>
    runShotGeneration(store, {
      shotId: shot.id,
      field: "keyframe",
      kind: "image",
      phase: "storyboard",
      scopeLabel: `Escena ${sceneOf(shot.sceneId).number} · Plano ${shot.order}`,
    });

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>🎬 Storyboard</h1>
          <p className="muted">
            Grid de keyframes del corto completo. Aprueba cada plano para
            habilitar el gate.
          </p>
        </div>
        <GateButton
          state={gate}
          label="Validar storyboard → ir a Producción"
          onValidate={block.validate}
        />
      </header>

      <ContextualActions actions={block.getActions()} />

      {grouped.map(({ scene, shots }) => (
        <section key={scene.id} className="sb-group">
          <h2 className="sb-group__title">
            Escena {scene.number} · {scene.heading}
          </h2>
          <div className="grid">
            {shots.map((shot) => {
              const pre = generation.preflight({
                kind: "image",
                prompt: shot.keyframePrompt,
                model: shot.imageModel,
              });
              return (
                <article
                  className={`kf ${shot.approvedKeyframe ? "kf--ok" : ""}`}
                  key={shot.id}
                >
                  <div className="kf__img">
                    {shot.keyframeUrl ? (
                      <img src={shot.keyframeUrl} alt={shot.description} />
                    ) : (
                      <div className="kf__empty">Sin keyframe</div>
                    )}
                  </div>
                  <div className="kf__meta">
                    <span className="tag">Plano {shot.order}</span>
                    <JobBadge job={shot.keyframeJob} />
                  </div>
                  <textarea
                    className="kf__prompt"
                    value={shot.keyframePrompt}
                    onChange={(e) =>
                      update((d) => {
                        d.shots.find((x) => x.id === shot.id)!.keyframePrompt =
                          e.target.value;
                      })
                    }
                  />
                  <div className="kf__row muted small">
                    <span>{shot.imageModel}</span>
                    <span title={pre.notes}>
                      ~{pre.credits} cr · {pre.transportLabel}
                    </span>
                  </div>
                  <div className="kf__actions">
                    <button onClick={() => regen(shot)}>Regenerar</button>
                    <button
                      onClick={() => {
                        update((d) => {
                          const s = d.shots.find((x) => x.id === shot.id)!;
                          if (!/ángulo/i.test(s.keyframePrompt))
                            s.keyframePrompt += " — variación de ángulo";
                        });
                        regen(shot);
                      }}
                    >
                      Variar ángulo
                    </button>
                    <button
                      className={shot.approvedKeyframe ? "is-on" : ""}
                      disabled={!shot.keyframeUrl}
                      onClick={() =>
                        update((d) => {
                          const s = d.shots.find((x) => x.id === shot.id)!;
                          s.approvedKeyframe = !s.approvedKeyframe;
                        })
                      }
                    >
                      {shot.approvedKeyframe ? "✓ Aprobado" : "Aprobar plano"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
