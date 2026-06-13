import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { JobBadge } from "@/components/JobBadge";
import { totals } from "@/state/consumption";

export function DeliveryPage() {
  const { project, update } = useStore();
  const block = useActiveBlock();
  const t = totals(project);
  const d = project.delivery;

  if (block.getGateState() === "locked") {
    return (
      <div className="page locked-page">
        <h1>🔒 Entrega</h1>
        <p className="muted">
          Se desbloquea cuando todas las escenas de Producción están validadas.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>📦 Entrega</h1>
          <p className="muted">Vídeo final ensamblado, descargas y export.</p>
        </div>
      </header>

      <ContextualActions actions={block.getActions()} />

      <section className="cards">
        <div className="card">
          <label className="card__label">Vídeo final</label>
          <div className="delivery__player">
            {d.finalVideoUrl ? (
              <img src={d.finalVideoUrl} alt="vídeo final" />
            ) : (
              <div className="kf__empty">Aún sin ensamblar</div>
            )}
          </div>
          <div className="kf__row">
            <JobBadge job={d.finalVideoJob} />
            {d.finalVideoUrl ? (
              <a className="mini" href={d.finalVideoUrl} download="la-esfera.mp4">
                Descargar
              </a>
            ) : null}
          </div>
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
              <span>Créditos Magnific</span>
              <b>{t.magnificCredits} cr</b>
            </li>
            <li>
              <span>Coste Claude</span>
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
            {d.exportedSpaceUrl ? "✓ Exportado a Spaces" : "Exportar a Spaces"}
          </button>
          {d.exportedSpaceUrl ? (
            <p className="muted small">{d.exportedSpaceUrl}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
