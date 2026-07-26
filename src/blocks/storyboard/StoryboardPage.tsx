import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDownload,
  IconLock,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { JobBadge } from "@/components/JobBadge";
import { ModelSelect } from "@/components/ModelSelect";
import { AssetModal, type PreviewAsset } from "@/components/AssetModal";
import { ConfirmGenerateModal } from "@/components/ConfirmGenerateModal";
import {
  alternativeModel,
  estCreditsFor,
  expectedSecFor,
  useModels,
} from "@/generation/models";
import { downloadAsset } from "@/state/download";
import { newShot } from "@/state/seed";
import { assignReferences } from "@/director/generate";
import { AssetImg } from "@/components/AssetImg";
import { runBatched, runShotGeneration } from "../runner";
import { IconSparkles, IconWand } from "@tabler/icons-react";
import type { Shot } from "@/types/project";
import { LockableTextarea } from "@/share/LockableTextarea";
import { showAppAlert } from "@/components/AppAlert";

export function StoryboardPage() {
  const store = useStore();
  const { project, update, generation } = store;
  const block = useActiveBlock();
  const gate = block.getGateState();
  const imageModels = useModels("image");
  const [assigning, setAssigning] = useState(false);

  const libChars = (project.library ?? []).filter((a) => a.type === "character");
  const libLocs = (project.library ?? []).filter((a) => a.type === "location");
  const styleAsset = project.library?.find((a) => a.id === project.styleId);

  const runAssign = async (silent = false) => {
    if (assigning) return;
    setAssigning(true);
    try {
      await assignReferences(store);
    } catch (e) {
      if (!silent) showAppAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(false);
    }
  };

  // When reaching Storyboard (Historia + Guion validated), auto-assign scenes
  // once if there are library assets and nothing has been assigned yet.
  const autoAssigned = useRef(false);
  useEffect(() => {
    if (autoAssigned.current || gate === "locked" || assigning) return;
    const hasAssets = libChars.length > 0 || libLocs.length > 0;
    const hasScenes = project.scenes.length > 0;
    const hasKey = !!project.settings.anthropicApiKey?.trim();
    const noneAssigned =
      project.scenes.every((s) => !s.locationId && !(s.characterIds && s.characterIds.length)) &&
      project.shots.every((sh) => sh.characterIds === undefined);
    if (hasAssets && hasScenes && hasKey && noneAssigned) {
      autoAssigned.current = true;
      void runAssign(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, libChars.length, libLocs.length, project.scenes.length]);

  const setSceneLocation = (sceneId: string, locId: string) =>
    update((d) => {
      const s = d.scenes.find((x) => x.id === sceneId);
      if (s) s.locationId = locId || undefined;
    });

  // Per-shot character overrides (the environment is per scene; inherited).
  const toggleShotChar = (shotId: string, sceneChars: string[], charId: string) =>
    update((d) => {
      const s = d.shots.find((x) => x.id === shotId);
      if (!s) return;
      const set = new Set(s.characterIds ?? sceneChars);
      if (set.has(charId)) set.delete(charId);
      else set.add(charId);
      s.characterIds = [...set];
    });
  const resetShotRefs = (shotId: string) =>
    update((d) => {
      const s = d.shots.find((x) => x.id === shotId);
      if (s) {
        s.characterIds = undefined;
        s.locationId = undefined;
      }
    });
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const runAll = async (model: string) => {
    setBatchOpen(false);
    const targets = [...store.project.shots];
    update((d) => d.shots.forEach((s) => (s.imageModel = model)));
    // In batches of 3 so we don't saturate the MCP.
    let done = 0;
    setBatchProgress({ done, total: targets.length });
    await runBatched(targets, 3, async (shot) => {
      const sc = store.project.scenes.find((x) => x.id === shot.sceneId);
      await runShotGeneration(store, {
        shotId: shot.id,
        field: "keyframe",
        kind: "image",
        phase: "storyboard",
        scopeLabel: `Escena ${sc?.number ?? "?"} · Plano ${shot.order}`,
        modelOverride: model,
      });
      done += 1;
      setBatchProgress({ done, total: targets.length });
    });
    setBatchProgress(null);
  };

  if (gate === "locked") {
    return (
      <div className="page locked-page">
        <h1><IconLock size={24} /> Storyboard</h1>
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

  // Move a shot up/down within its scene (renumbers that scene's shots).
  const moveShot = (sceneId: string, shotId: string, dir: -1 | 1) =>
    update((d) => {
      const inScene = d.shots
        .filter((x) => x.sceneId === sceneId)
        .sort((a, b) => a.order - b.order);
      const i = inScene.findIndex((x) => x.id === shotId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= inScene.length) return;
      [inScene[i], inScene[j]] = [inScene[j], inScene[i]];
      inScene.forEach((x, k) => {
        d.shots.find((s) => s.id === x.id)!.order = k + 1;
      });
    });

  /** Flip the active keyframe to a previous/next generation in its history. */
  const stepKeyframe = (shotId: string, dir: -1 | 1) =>
    update((d) => {
      const s = d.shots.find((x) => x.id === shotId)!;
      const h = s.keyframeHistory ?? [];
      if (h.length < 2) return;
      const i = Math.max(0, h.indexOf(s.keyframeUrl ?? ""));
      s.keyframeUrl = h[(i + dir + h.length) % h.length];
      s.approvedKeyframe = false;
    });

  return (
    <div className="page">
      <ContextualActions actions={block.getActions()} />

      {project.shots.length > 0 ? (
        <div className="actions">
          <button className="action action--gen" onClick={() => setBatchOpen(true)}>
            Generar todos los keyframes
          </button>
          {project.shots.some((s) => s.keyframeUrl && !s.approvedKeyframe) ? (
            <button
              className="action"
              onClick={() =>
                update((d) =>
                  d.shots.forEach((s) => {
                    if (s.keyframeUrl) s.approvedKeyframe = true;
                  }),
                )
              }
            >
              <IconCheck size={15} /> Aprobar todos
            </button>
          ) : null}
          {libChars.length > 0 || libLocs.length > 0 ? (
            <button className="action" disabled={assigning} onClick={() => runAssign()} title="Claude asigna personajes y entorno a cada escena">
              {assigning ? <span className="spin" /> : <IconWand size={15} />} Asignar referencias
            </button>
          ) : null}
          {styleAsset ? (
            <span className="conn" title="Estilo visual global activo">
              <IconSparkles size={14} /> Estilo: {styleAsset.name}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="onboard">
          Aquí verás un keyframe por plano. Genera o ajusta el <b>Guion</b> para
          tener escenas y planos, y luego genera las imágenes.
        </p>
      )}

      {batchProgress ? (
        <p className="onboard">
          <span className="spin" /> Generando keyframes… {batchProgress.done}/
          {batchProgress.total}
        </p>
      ) : null}

      {grouped.map(({ scene, shots }) => (
        <section key={scene.id} className="sb-group">
          <h2 className="sb-group__title">
            <span>
              Escena {scene.number} · {scene.heading}
            </span>
            {shots.some((s) => s.keyframeUrl && !s.approvedKeyframe) ? (
              <button
                className="mini"
                title="Aprobar todos los planos de esta escena"
                onClick={() =>
                  update((d) => {
                    d.shots
                      .filter((x) => x.sceneId === scene.id && x.keyframeUrl)
                      .forEach((x) => (x.approvedKeyframe = true));
                  })
                }
              >
                <IconCheck size={14} /> Aprobar escena
              </button>
            ) : null}
            <button
              className="icon-btn"
              title="Eliminar escena"
              onClick={() => {
                if (!confirm(`¿Eliminar la Escena ${scene.number} y sus planos?`)) return;
                update((d) => {
                  d.scenes = d.scenes.filter((x) => x.id !== scene.id);
                  d.scenes.forEach((x, i) => (x.number = i + 1));
                  d.shots = d.shots.filter((x) => x.sceneId !== scene.id);
                });
              }}
            >
              <IconTrash size={15} />
            </button>
          </h2>

          {libLocs.length > 0 ? (
            <div className="scene-refs">
              <label className="scene-refs__loc">
                Entorno de la escena
                <select
                  className="model-select"
                  value={scene.locationId ?? ""}
                  onChange={(e) => setSceneLocation(scene.id, e.target.value)}
                >
                  <option value="">Sin entorno</option>
                  {libLocs.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              {(() => {
                const sel = libLocs.find((l) => l.id === scene.locationId);
                return sel && !sel.magnificIdentifier ? (
                  <span className="small refwarn" title="Sin la referencia, la imagen del plano se genera solo con texto">
                    ⚠ «{sel.name}» aún no está en la Magnific Library — genera su imagen en Historia → Casting para que sirva de referencia.
                  </span>
                ) : (
                  <span className="muted small">Los personajes se asignan por plano (abajo en cada uno).</span>
                );
              })()}
            </div>
          ) : null}

          <div className="grid">
            {shots.map((shot, sidx) => {
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
                      <img
                        className="asset-clickable"
                        src={shot.keyframeUrl}
                        alt={shot.description}
                        onClick={() =>
                          setPreview({ url: shot.keyframeUrl!, kind: "image" })
                        }
                      />
                    ) : (
                      <div className="kf__empty">Sin keyframe</div>
                    )}
                    {(shot.keyframeHistory?.length ?? 0) > 1 ? (
                      <div className="cover-nav">
                        <button onClick={() => stepKeyframe(shot.id, -1)} title="Generación anterior">
                          <IconChevronLeft size={16} />
                        </button>
                        <span>
                          {(shot.keyframeHistory!.indexOf(shot.keyframeUrl ?? "") + 1) || 1}/
                          {shot.keyframeHistory!.length}
                        </span>
                        <button onClick={() => stepKeyframe(shot.id, 1)} title="Generación siguiente">
                          <IconChevronRight size={16} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="kf__meta">
                    <span className="tag">Plano {shot.order}</span>
                    <button
                      className="icon-btn"
                      title="Subir plano"
                      disabled={sidx === 0}
                      onClick={() => moveShot(scene.id, shot.id, -1)}
                    >
                      <IconChevronUp size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Bajar plano"
                      disabled={sidx === shots.length - 1}
                      onClick={() => moveShot(scene.id, shot.id, 1)}
                    >
                      <IconChevronDown size={14} />
                    </button>
                    <JobBadge
                      job={shot.keyframeJob}
                      etaSec={expectedSecFor("image", shot.imageModel)}
                    />
                  </div>
                  <LockableTextarea
                    lockPath={`shot:${shot.id}:keyframePrompt`}
                    className="kf__prompt"
                    value={shot.keyframePrompt}
                    onChange={(e) =>
                      update((d) => {
                        d.shots.find((x) => x.id === shot.id)!.keyframePrompt =
                          e.target.value;
                      })
                    }
                  />
                  {libChars.length > 0 ? (
                    <div className="shot-refs">
                      <span className="muted small">Personajes:</span>
                      <div className="shot-refs__chars">
                        {libChars.map((c) => {
                          const on = (shot.characterIds ?? scene.characterIds ?? []).includes(c.id);
                          const noRef = on && !c.magnificIdentifier;
                          return (
                            <button
                              key={c.id}
                              className={`char-pick ${on ? "char-pick--on" : ""} ${noRef ? "char-pick--warn" : ""}`}
                              title={noRef ? `${c.name} — aún no está en la Magnific Library: el plano se generará sin su referencia. Genera su imagen en Historia → Casting.` : c.name}
                              onClick={() => toggleShotChar(shot.id, scene.characterIds ?? [], c.id)}
                            >
                              <AssetImg
                                candidates={[c.thumbnailUrl ?? "", ...(c.images ?? [])]}
                                projectId={project.id}
                                alt={c.name}
                                fallback={<span className="char-pick__ph">{c.name.slice(0, 1)}</span>}
                              />
                            </button>
                          );
                        })}
                        {shot.characterIds !== undefined ? (
                          <button className="char-pick char-pick--reset" title="Volver a heredar de la escena" onClick={() => resetShotRefs(shot.id)}>
                            ↺
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="kf__row muted small">
                    <ModelSelect
                      models={imageModels}
                      value={shot.imageModel}
                      onChange={(slug) =>
                        update((d) => {
                          d.shots.find((x) => x.id === shot.id)!.imageModel = slug;
                        })
                      }
                    />
                    <span title={pre.notes}>
                      ~{estCreditsFor("image", shot.imageModel)} cr
                    </span>
                  </div>
                  {shot.keyframeJob?.status === "rendering" ? (
                    <div className="queue">
                      <div
                        className="queue__bar"
                        style={{ width: `${shot.keyframeJob.progress}%` }}
                      />
                    </div>
                  ) : null}
                  <div className="kf__actions">
                    <button onClick={() => regen(shot)}>
                      {shot.keyframeUrl ? "Regenerar" : "Generar"}
                    </button>
                    <button
                      onClick={() => {
                        update((d) => {
                          const s = d.shots.find((x) => x.id === shot.id)!;
                          if (!/ángulo/i.test(s.keyframePrompt))
                            s.keyframePrompt += ", variación de ángulo";
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
                      {shot.approvedKeyframe ? (
                        <>
                          <IconCheck size={15} /> Aprobado
                        </>
                      ) : (
                        "Aprobar plano"
                      )}
                    </button>
                    {shot.keyframeUrl ? (
                      <button
                        className="icon-btn"
                        title="Descargar keyframe"
                        onClick={() =>
                          downloadAsset(
                            shot.keyframeUrl!,
                            `escena-${sceneOf(shot.sceneId).number}-plano-${shot.order}-keyframe`,
                          )
                        }
                      >
                        <IconDownload size={15} />
                      </button>
                    ) : null}
                    <button
                      className="icon-btn"
                      title="Eliminar plano"
                      onClick={() =>
                        update((d) => {
                          d.shots = d.shots.filter((x) => x.id !== shot.id);
                        })
                      }
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                  {shot.keyframeJob?.status === "failed" ? (
                    <div className="kf__fail">
                      <span>{shot.keyframeJob.error ?? "Falló la generación."}</span>
                      <button
                        className="mini"
                        onClick={() => {
                          const alt = alternativeModel(imageModels, shot.imageModel);
                          update((d) => {
                            d.shots.find((x) => x.id === shot.id)!.imageModel = alt;
                          });
                          regen(shot);
                        }}
                      >
                        Reintentar con otro modelo
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <button
            className="mini"
            onClick={() =>
              update((d) => {
                const order =
                  Math.max(
                    0,
                    ...d.shots.filter((x) => x.sceneId === scene.id).map((x) => x.order),
                  ) + 1;
                d.shots.push(newShot(scene.id, order, {}));
              })
            }
          >
            <IconPlus size={15} /> Añadir plano
          </button>
        </section>
      ))}
      {preview ? (
        <AssetModal {...preview} onClose={() => setPreview(null)} />
      ) : null}
      {batchOpen ? (
        <ConfirmGenerateModal
          title="Generar todos los keyframes"
          count={project.shots.length}
          kind="image"
          onConfirm={runAll}
          onClose={() => setBatchOpen(false)}
        />
      ) : null}
    </div>
  );
}
