import { useState } from "react";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconLock,
  IconMovie,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { JobBadge } from "@/components/JobBadge";
import { ModelSelect } from "@/components/ModelSelect";
import { AssetModal, type PreviewAsset } from "@/components/AssetModal";
import { ConfirmGenerateModal } from "@/components/ConfirmGenerateModal";
import {
  alternativeModel,
  estCreditsFor,
  expectedSecFor,
  modelSupportsRef,
  useModels,
} from "@/generation/models";
import { downloadAsset } from "@/state/download";
import { runBatched, runShotGeneration } from "../runner";
import type { Scene, Shot } from "@/types/project";

export function ProductionPage() {
  const store = useStore();
  const { project, update, generation, activeSceneId, setActiveSceneId } = store;
  const block = useActiveBlock();
  const videoModels = useModels("video");
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [batchScope, setBatchScope] = useState<"scene" | "all" | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  if (block.getGateState() === "locked") {
    return (
      <div className="page locked-page">
        <h1><IconLock size={24} /> Producción</h1>
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

  const stepVideo = (shotId: string, dir: -1 | 1) =>
    update((d) => {
      const s = d.shots.find((x) => x.id === shotId)!;
      const h = s.videoHistory ?? [];
      if (h.length < 2) return;
      const i = Math.max(0, h.indexOf(s.videoUrl ?? ""));
      s.videoUrl = h[(i + dir + h.length) % h.length];
      s.approvedVideo = false;
    });

  const batchTargets = batchScope === "all" ? project.shots : activeShots;

  const runAllVideos = async (model: string) => {
    const targets = batchScope === "all" ? [...store.project.shots] : [...activeShots];
    setBatchScope(null);
    const ids = new Set(targets.map((t) => t.id));
    update((d) => d.shots.forEach((s) => ids.has(s.id) && (s.videoModel = model)));
    // Video is heavy → smaller batches (2 at a time).
    let done = 0;
    setBatchProgress({ done, total: targets.length });
    await runBatched(targets, 2, async (shot) => {
      const sc = store.project.scenes.find((x) => x.id === shot.sceneId);
      await runShotGeneration(store, {
        shotId: shot.id,
        field: "video",
        kind: "video",
        phase: "production",
        scopeLabel: `Escena ${sc?.number ?? "?"} · Plano ${shot.order}`,
        modelOverride: model,
      });
      done += 1;
      setBatchProgress({ done, total: targets.length });
    });
    setBatchProgress(null);
  };

  return (
    <div className="page production">
      <header className="page__head">
        <div>
          <h1><IconMovie size={24} /> Producción</h1>
          <p className="muted">
            Escena por escena, plano por plano. Cada plano es un job de vídeo con
            su coste y estado.
          </p>
        </div>
        {project.shots.length > 0 ? (
          <button
            className="action action--gen"
            onClick={() => setBatchScope("all")}
          >
            Generar todos los vídeos
          </button>
        ) : null}
      </header>

      {batchProgress ? (
        <p className="onboard">
          <span className="spin" /> Generando vídeos… {batchProgress.done}/
          {batchProgress.total}. Cambia de escena en la lista para ver cada uno.
        </p>
      ) : null}

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
                {activeShots.length > 0 ? (
                  <button
                    className="mini"
                    onClick={() => setBatchScope("scene")}
                  >
                    Generar vídeos de la escena
                  </button>
                ) : null}
                {activeShots.some((s) => s.videoUrl && !s.approvedVideo) ? (
                  <button
                    className="mini"
                    title="Aprobar todos los planos con vídeo de esta escena"
                    onClick={() =>
                      update((d) => {
                        d.shots
                          .filter((x) => x.sceneId === active.id && x.videoUrl)
                          .forEach((x) => (x.approvedVideo = true));
                      })
                    }
                  >
                    <IconCheck size={14} /> Aprobar planos
                  </button>
                ) : null}
                {(() => {
                  const validated = project.gates.production[active.id] === "validated";
                  const pending = activeShots.filter((s) => !s.approvedVideo).length;
                  const ready = activeShots.length > 0 && pending === 0;
                  return (
                    <button
                      className={`gate gate--${validated ? "validated" : ready ? "ready" : "in_progress"}`}
                      disabled={validated || !ready}
                      onClick={block.validate}
                    >
                      {validated ? (
                        <>
                          <IconCheck size={15} /> Escena validada
                        </>
                      ) : ready ? (
                        "Validar escena"
                      ) : (
                        `Validar escena · ${pending} pendiente${pending > 1 ? "s" : ""}`
                      )}
                    </button>
                  );
                })()}
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
                        {shot.videoUrl ? (
                          <div className="prod-card__video">
                            <div
                              className="asset-clickable"
                              onClick={() =>
                                setPreview({ url: shot.videoUrl!, kind: "video" })
                              }
                            >
                              <video src={shot.videoUrl} muted preload="metadata" />
                              <span className="play-badge">
                                <IconPlayerPlay size={22} />
                              </span>
                            </div>
                            {(shot.videoHistory?.length ?? 0) > 1 ? (
                              <div className="cover-nav">
                                <button onClick={() => stepVideo(shot.id, -1)} title="Generación anterior">
                                  <IconChevronLeft size={16} />
                                </button>
                                <span>
                                  {(shot.videoHistory!.indexOf(shot.videoUrl ?? "") + 1) || 1}/
                                  {shot.videoHistory!.length}
                                </span>
                                <button onClick={() => stepVideo(shot.id, 1)} title="Generación siguiente">
                                  <IconChevronRight size={16} />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : shot.keyframeUrl ? (
                          <img
                            className="asset-clickable"
                            src={shot.keyframeUrl}
                            alt="keyframe origen"
                            onClick={() =>
                              setPreview({ url: shot.keyframeUrl!, kind: "image" })
                            }
                          />
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
                          <span className="model-pick">
                            <ModelSelect
                              models={videoModels}
                              value={shot.videoModel}
                              onChange={(slug) =>
                                update((d) => {
                                  d.shots.find(
                                    (x) => x.id === shot.id,
                                  )!.videoModel = slug;
                                })
                              }
                            />
                            <span>· {shot.videoDurationSec}s</span>
                          </span>
                          <span title={pre.notes}>
                            ~{estCreditsFor("video", shot.videoModel)} cr
                          </span>
                        </div>
                        {shot.keyframeUrl && modelSupportsRef(videoModels, shot.videoModel) ? (
                          <div className="kf__row muted small">
                            <span>Usar keyframe como</span>
                            <select
                              className="model-select"
                              value={shot.videoRefMode ?? "reference"}
                              onChange={(e) =>
                                update((d) => {
                                  d.shots.find((x) => x.id === shot.id)!.videoRefMode =
                                    e.target.value as "keyframe" | "reference";
                                })
                              }
                            >
                              <option value="reference">Referencia</option>
                              <option value="keyframe">Frame inicial</option>
                            </select>
                          </div>
                        ) : null}
                        <div className="prod-card__status">
                          <JobBadge
                            job={shot.videoJob}
                            etaSec={expectedSecFor("video", shot.videoModel)}
                          />
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
                          <button onClick={() => regen(shot)}>
                            {shot.videoUrl ? "Regenerar" : "Generar"}
                          </button>
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
                            {shot.approvedVideo ? (
                              <>
                                <IconCheck size={15} /> Aprobado
                              </>
                            ) : (
                              "Aprobar plano"
                            )}
                          </button>
                          {shot.videoUrl ? (
                            <button
                              className="icon-btn"
                              title="Descargar vídeo"
                              onClick={() =>
                                downloadAsset(
                                  shot.videoUrl!,
                                  `escena-${active.number}-plano-${shot.order}-video`,
                                )
                              }
                            >
                              <IconDownload size={15} />
                            </button>
                          ) : null}
                        </div>
                        {shot.videoJob?.status === "failed" ? (
                          <div className="kf__fail">
                            <span>{shot.videoJob.error ?? "Falló la generación."}</span>
                            <button
                              className="mini"
                              onClick={() => {
                                const alt = alternativeModel(videoModels, shot.videoModel);
                                update((d) => {
                                  d.shots.find((x) => x.id === shot.id)!.videoModel = alt;
                                });
                                regen(shot);
                              }}
                            >
                              Reintentar con otro modelo
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="onboard">
              Aquí produces el vídeo de cada plano, escena por escena. Genera el
              <b> Guion</b> y aprueba el <b>Storyboard</b> para empezar.
            </p>
          )}
        </section>
      </div>
      {preview ? (
        <AssetModal {...preview} onClose={() => setPreview(null)} />
      ) : null}
      {batchScope ? (
        <ConfirmGenerateModal
          title={
            batchScope === "all"
              ? "Generar todos los vídeos"
              : `Generar vídeos de la Escena ${active?.number ?? ""}`
          }
          count={batchTargets.length}
          kind="video"
          onConfirm={runAllVideos}
          onClose={() => setBatchScope(null)}
        />
      ) : null}
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
  // Only show the total plus the states that actually have a count.
  const stats = [`${shots.length} planos`];
  if (ready) stats.push(`${ready} listos`);
  if (queued) stats.push(`${queued} en cola`);
  if (pending) stats.push(`${pending} pendiente`);
  return (
    <button
      className={`scene-row ${active ? "scene-row--active" : ""} ${
        gate === "validated" ? "scene-row--ok" : ""
      }`}
      onClick={onClick}
    >
      <div className="scene-row__title">
        Escena {scene.number}
        {gate === "validated" ? <IconCheck size={15} /> : null}
      </div>
      <div className="scene-row__stats muted small">{stats.join(" · ")}</div>
    </button>
  );
}
