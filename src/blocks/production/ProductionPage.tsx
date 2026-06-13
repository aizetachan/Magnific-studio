import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { JobBadge } from "@/components/JobBadge";
import { runShotGeneration } from "../runner";
import type { Scene, Shot } from "@/types/project";

export function ProductionPage() {
  const store = useStore();
  const { project, update, generation, activeSceneId, setActiveSceneId } = store;
  const block = useActiveBlock();

  if (block.getGateState() === "locked") {
    return (
      <div className="page locked-page">
        <h1>🔒 Producción</h1>
        <p className="muted">Se desbloquea cuando validas el Storyboard.</p>
      </div>
    );
  }

  const scenes = [...project.scenes].sort((a, b) => a.number - b.number);
  const active =
    scenes.find((s) => s.id === activeSceneId) ?? scenes[0];
  const shotsOf = (id: string) =>
    project.shots.filter((s) => s.sceneId === id).sort((a, b) => a.order - b.order);

  const activeShots = active ? shotsOf(active.id) : [];

  const regen = (shot: Shot) =>
    runShotGeneration(store, {
      shotId: shot.id,
      field: "video",
      kind: "video",
      phase: "production",
      scopeLabel: `Escena ${active.number} · Plano ${shot.order}`,
    });

  return (
    <div className="page production">
      <header className="page__head">
        <div>
          <h1>🎞️ Producción</h1>
          <p className="muted">
            Escena por escena, plano por plano. Cada plano es un job de vídeo con
            su coste y estado.
          </p>
        </div>
      </header>

      <div className="prod-split">
        {/* Nivel 1 — Master de escenas */}
        <aside className="prod-master">
          <h3 className="prod-master__title">Escenas</h3>
          {scenes.map((sc) => (
            <SceneRow
              key={sc.id}
              scene={sc}
              shots={shotsOf(sc.id)}
              active={sc.id === active?.id}
              gate={project.gates.production[sc.id] ?? "in_progress"}
              onClick={() => setActiveSceneId(sc.id)}
            />
          ))}
        </aside>

        {/* Nivel 2 — Workspace de escena */}
        <section className="prod-workspace">
          {active ? (
            <>
              <div className="prod-ws-head">
                <h2>
                  Escena {active.number} · {active.heading}
                </h2>
                <button
                  className="gate gate--ready"
                  disabled={
                    activeShots.length === 0 ||
                    !activeShots.every((s) => s.approvedVideo) ||
                    project.gates.production[active.id] === "validated"
                  }
                  onClick={block.validate}
                >
                  {project.gates.production[active.id] === "validated"
                    ? "✓ Escena validada"
                    : "Escena validada"}
                </button>
              </div>

              <div className="prod-cards">
                {activeShots.map((shot) => {
                  const pre = generation.preflight({
                    kind: "video",
                    prompt: shot.videoPrompt,
                    model: shot.videoModel,
                    params: { duration: shot.videoDurationSec },
                  });
                  return (
                    <article
                      className={`prod-card ${shot.approvedVideo ? "prod-card--ok" : ""}`}
                      key={shot.id}
                    >
                      <div className="prod-card__origin">
                        {shot.keyframeUrl ? (
                          <img src={shot.keyframeUrl} alt="keyframe origen" />
                        ) : (
                          <div className="kf__empty">keyframe origen</div>
                        )}
                        <span className="tag">Plano {shot.order}</span>
                      </div>
                      <div className="prod-card__body">
                        <textarea
                          className="kf__prompt"
                          value={shot.videoPrompt}
                          onChange={(e) =>
                            update((d) => {
                              d.shots.find(
                                (x) => x.id === shot.id,
                              )!.videoPrompt = e.target.value;
                            })
                          }
                        />
                        <div className="kf__row muted small">
                          <span>
                            {shot.videoModel} · {shot.videoDurationSec}s
                          </span>
                          <span title={pre.notes}>
                            preflight ~{pre.credits} cr · {pre.transportLabel}
                          </span>
                        </div>
                        <div className="prod-card__status">
                          <JobBadge job={shot.videoJob} />
                          {shot.videoJob?.status === "rendering" ? (
                            <div className="queue">
                              <div
                                className="queue__bar"
                                style={{ width: `${shot.videoJob.progress}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                        <div className="kf__actions">
                          <button onClick={() => regen(shot)}>Regenerar</button>
                          <button
                            onClick={() => {
                              update((d) => {
                                const s = d.shots.find(
                                  (x) => x.id === shot.id,
                                )!;
                                if (!/cinematogr/i.test(s.videoPrompt))
                                  s.videoPrompt += " — más cinematográfico";
                              });
                              regen(shot);
                            }}
                          >
                            Variar
                          </button>
                          <button
                            className={shot.approvedVideo ? "is-on" : ""}
                            disabled={!shot.videoUrl}
                            onClick={() =>
                              update((d) => {
                                const s = d.shots.find(
                                  (x) => x.id === shot.id,
                                )!;
                                s.approvedVideo = !s.approvedVideo;
                              })
                            }
                          >
                            {shot.approvedVideo ? "✓ Aprobado" : "Aprobar plano"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted">No hay escenas.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function SceneRow({
  scene,
  shots,
  active,
  gate,
  onClick,
}: {
  scene: Scene;
  shots: Shot[];
  active: boolean;
  gate: string;
  onClick: () => void;
}) {
  const ready = shots.filter((s) => s.videoJob?.status === "ready").length;
  const queued = shots.filter(
    (s) => s.videoJob?.status === "queued" || s.videoJob?.status === "rendering",
  ).length;
  const pending = shots.length - ready - queued;
  return (
    <button
      className={`scene-row ${active ? "scene-row--active" : ""} ${
        gate === "validated" ? "scene-row--ok" : ""
      }`}
      onClick={onClick}
    >
      <div className="scene-row__title">
        Escena {scene.number}
        {gate === "validated" ? " ✓" : ""}
      </div>
      <div className="scene-row__stats muted small">
        {shots.length} planos · {ready} listos · {queued} en cola · {pending}{" "}
        pendiente
      </div>
    </button>
  );
}
