import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconLock } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { JobBadge } from "@/components/JobBadge";
import { config } from "@/config";
import { totals } from "@/state/consumption";
import { EditorPage } from "./EditorPage";

export function DeliveryPage() {
  const { project, update } = useStore();
  const block = useActiveBlock();
  const t = totals(project);
  const d = project.delivery;
  const [tab, setTab] = useState<"montaje" | "entrega">(
    project.delivery.finalVideoUrl ? "entrega" : "montaje",
  );

  // Real Magnific cost: ask the backend the actual credits for every creation
  // produced (creations_get), so the total is accurate even for past renders.
  const imageIds = useMemo(
    () => project.shots.map((s) => s.keyframeJob?.taskId).filter(Boolean) as string[],
    [project.shots],
  );
  const videoIds = useMemo(
    () => project.shots.map((s) => s.videoJob?.taskId).filter(Boolean) as string[],
    [project.shots],
  );
  const finalId = d.finalVideoJob?.id;

  const [perId, setPerId] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const ids = [...imageIds, ...videoIds, ...(finalId ? [finalId] : [])];
    if (ids.length === 0) {
      setPerId({});
      return;
    }
    let alive = true;
    setPerId(null);
    fetch(`${config.directorBase}/credits`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((r) => r.json())
      .then((data) => alive && setPerId(data.perId ?? {}))
      .catch(() => alive && setPerId({}));
    return () => {
      alive = false;
    };
  }, [imageIds, videoIds, finalId]);

  const sumOf = (ids: string[]) =>
    perId ? ids.reduce((n, id) => n + (perId[id] ?? 0), 0) : null;
  const imageCredits = sumOf(imageIds);
  const videoCredits = sumOf(videoIds);
  const finalCredits = sumOf(finalId ? [finalId] : []);
  const totalCredits =
    perId === null
      ? null
      : (imageCredits ?? 0) + (videoCredits ?? 0) + (finalCredits ?? 0);
  const fmt = (n: number | null) => (n === null ? "calculando…" : `${n} cr`);
  const eur = (n: number | null) =>
    n === null ? "calculando…" : `≈ €${(n * config.magnificCreditEur).toFixed(2)}`;

  if (block.getGateState() === "locked") {
    return (
      <div className="page locked-page">
        <h1><IconLock size={24} /> Entrega</h1>
        <p className="muted">
          Se desbloquea cuando todas las escenas de Producción están validadas.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="tabs">
        <button
          className={`tab ${tab === "montaje" ? "tab--on" : ""}`}
          onClick={() => setTab("montaje")}
        >
          Montaje
        </button>
        <button
          className={`tab ${tab === "entrega" ? "tab--on" : ""}`}
          onClick={() => setTab("entrega")}
        >
          Entrega
        </button>
      </div>

      {tab === "montaje" ? <EditorPage /> : null}

      {tab === "entrega" ? (
      <>
      <ContextualActions actions={block.getActions()} />

      <section className="cards">
        <div className="card">
          <label className="card__label">Vídeo final</label>
          <div className="delivery__player">
            {d.finalVideoUrl ? (
              <video src={d.finalVideoUrl} controls />
            ) : d.finalVideoJob?.status === "rendering" ? (
              <div className="kf__empty">Ensamblando…</div>
            ) : (
              <div className="kf__empty">Aún sin ensamblar</div>
            )}
          </div>
          {d.finalVideoJob?.status === "rendering" ? (
            <div className="queue" style={{ margin: "8px 0" }}>
              <div
                className="queue__bar"
                style={{ width: `${d.finalVideoJob.progress}%` }}
              />
            </div>
          ) : null}
          <div className="kf__row">
            <JobBadge job={d.finalVideoJob} />
            {d.finalVideoUrl ? (
              <a className="mini" href={d.finalVideoUrl} download="video-final.mp4">
                Descargar
              </a>
            ) : null}
          </div>
          {d.finalVideoJob?.status === "failed" && d.finalVideoJob.error ? (
            <p className="muted small" style={{ color: "var(--err, #d05656)" }}>
              {d.finalVideoJob.error}
            </p>
          ) : null}
        </div>

        <div className="card">
          <label className="card__label">Metadatos & consumo total</label>
          <ul className="meta-list">
            <li>
              <span>Escenas</span>
              <b>{project.scenes.length}</b>
            </li>
            <li>
              <span>Planos</span>
              <b>{project.shots.length}</b>
            </li>
            <li>
              <span>Créditos · imágenes ({imageIds.length})</span>
              <b>{fmt(imageCredits)}</b>
            </li>
            <li>
              <span>Créditos · vídeos ({videoIds.length})</span>
              <b>{fmt(videoCredits)}</b>
            </li>
            {finalId ? (
              <li>
                <span>Créditos · vídeo final</span>
                <b>{fmt(finalCredits)}</b>
              </li>
            ) : null}
            <li>
              <span>
                <b>Total Magnific</b>
              </span>
              <b>{fmt(totalCredits)}</b>
            </li>
            <li>
              <span>Coste estimado</span>
              <b>{eur(totalCredits)}</b>
            </li>
            <li>
              <span>Coste Claude (chat)</span>
              <b>${t.claudeCostUsd.toFixed(4)}</b>
            </li>
          </ul>
          <button
            className="mini"
            disabled={!d.finalVideoUrl || !!d.exportedSpaceUrl}
            onClick={() =>
              update((p) => {
                // Explode the finished project into a Spaces board (spaces_create).
                p.delivery.exportedSpaceUrl =
                  "https://magnific.com/spaces/" + p.id;
              })
            }
          >
            {d.exportedSpaceUrl ? (
              <>
                <IconCheck size={15} /> Exportado a Spaces
              </>
            ) : (
              "Exportar a Spaces"
            )}
          </button>
          {d.exportedSpaceUrl ? (
            <p className="muted small">{d.exportedSpaceUrl}</p>
          ) : null}
        </div>
      </section>
      </>
      ) : null}
    </div>
  );
}
