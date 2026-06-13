import { useState } from "react";
import { useStore } from "@/state/ProjectStore";
import { AnthropicClient } from "@/director/AnthropicClient";
import { config } from "@/config";
import {
  PHASE_LABELS,
  creditsByPhase,
  totals,
} from "@/state/consumption";

const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];

/**
 * Settings (§5.3) — connect your own Anthropic API key, see exactly what you
 * consume (Claude tokens/cost + Magnific credits with preflight), and manage the
 * shared library. The API key lives only in memory and is never exported.
 */
export function SettingsPage() {
  const { project, update, generation } = useStore();
  const s = project.settings;
  const t = totals(project);
  const byPhase = creditsByPhase(project);
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      const client = new AnthropicClient(s.anthropicApiKey, s.directorModel);
      if (!client.hasKey) {
        update((d) => {
          d.settings.connectionTested = "failed";
        });
        return;
      }
      await client.send(
        {
          phase: "story",
          phaseLabel: "Test",
          visibleObjects: {},
          allowedActions: [],
          blockedActions: [],
          implicitReferent: "test",
        },
        [{ role: "user", content: "ping" }],
        () => "pong",
      );
      update((d) => {
        d.settings.connectionTested = "ok";
      });
    } catch {
      update((d) => {
        d.settings.connectionTested = "failed";
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>⚙️ Ajustes</h1>
          <p className="muted">
            Conecta tu cuenta y mira exactamente lo que consumes.
          </p>
        </div>
      </header>

      <section className="cards">
        <div className="card">
          <label className="card__label">API de Anthropic (Claude)</label>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={s.anthropicApiKey}
            onChange={(e) =>
              update((d) => {
                d.settings.anthropicApiKey = e.target.value;
                d.settings.connectionTested = "untested";
              })
            }
          />
          <p className="muted small">
            Se guarda solo en memoria de la sesión. Nunca se exporta ni se
            hardcodea.
          </p>
          <label className="card__label">Modelo del director</label>
          <select
            value={s.directorModel}
            onChange={(e) =>
              update((d) => {
                d.settings.directorModel = e.target.value;
              })
            }
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="kf__row">
            <button className="mini" disabled={testing} onClick={testConnection}>
              {testing ? "Probando…" : "Probar conexión"}
            </button>
            <span
              className={`conn conn--${s.connectionTested}`}
            >
              {s.connectionTested === "ok"
                ? "✓ Conectado"
                : s.connectionTested === "failed"
                  ? "✗ Sin conexión (modo offline)"
                  : "Sin probar"}
            </span>
          </div>
        </div>

        <div className="card">
          <label className="card__label">Magnific (generación)</label>
          <p className="muted small">
            MCP (OAuth) es la capa por defecto. La API REST Business habilita
            webhooks y la Analytics API para medición real.
          </p>
          <input
            type="password"
            placeholder="API key de Magnific Business"
            value={s.magnificApiKey}
            onChange={(e) =>
              update((d) => {
                d.settings.magnificApiKey = e.target.value;
                d.settings.magnificApiConnected = e.target.value.trim() !== "";
              })
            }
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.magnificApiConnected}
              onChange={(e) => {
                update((d) => {
                  d.settings.magnificApiConnected = e.target.checked;
                });
                generation.setApiConnected(e.target.checked);
              }}
            />
            ApiTransport (Business) conectado
          </label>
          <p className="muted small">
            Generación{" "}
            {config.magnificLive ? (
              <b className="ok">en vivo</b>
            ) : (
              <b>simulada</b>
            )}{" "}
            · base {config.magnificApiBase}. Para llamadas reales:{" "}
            <code>VITE_MAGNIFIC_LIVE=true</code> + API key.
          </p>
          <ul className="meta-list">
            <li>
              <span>McpTransport</span>
              <b className="ok">sano</b>
            </li>
            <li>
              <span>ApiTransport</span>
              <b className={s.magnificApiConnected ? "ok" : "off"}>
                {s.magnificApiConnected ? "sano" : "desconectado"}
              </b>
            </li>
          </ul>
        </div>
      </section>

      <section className="cards">
        <div className="card">
          <label className="card__label">Consumo de Claude (transparencia)</label>
          <ul className="meta-list">
            <li>
              <span>Tokens entrada</span>
              <b>{t.claudeInputTokens.toLocaleString()}</b>
            </li>
            <li>
              <span>Tokens salida</span>
              <b>{t.claudeOutputTokens.toLocaleString()}</b>
            </li>
            <li>
              <span>Coste estimado</span>
              <b>${t.claudeCostUsd.toFixed(4)}</b>
            </li>
          </ul>
        </div>

        <div className="card">
          <label className="card__label">Créditos Magnific por fase</label>
          <ul className="meta-list">
            {Object.keys(PHASE_LABELS).map((p) => (
              <li key={p}>
                <span>{PHASE_LABELS[p as keyof typeof PHASE_LABELS]}</span>
                <b>{byPhase[p] ?? 0} cr</b>
              </li>
            ))}
            <li className="meta-list__total">
              <span>Total</span>
              <b>{t.magnificCredits} cr</b>
            </li>
          </ul>
        </div>
      </section>

      <section className="cards">
        <div className="card card--list">
          <label className="card__label">Biblioteca compartida</label>
          <p className="muted small">
            Personajes / locations reutilizables (alineado con library_create),
            compartibles entre proyectos y con el resto de la suite.
          </p>
          {project.library.map((a) => (
            <div className="row" key={a.id}>
              <span className="tag">{a.type}</span>
              <span className="row__title">{a.name}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <label className="card__label">Historial de consumo</label>
          <div className="history">
            {project.consumption.events.length === 0 ? (
              <p className="muted small">Aún sin eventos.</p>
            ) : (
              [...project.consumption.events]
                .reverse()
                .slice(0, 30)
                .map((e) => (
                  <div className="history__row" key={e.id}>
                    <span className={`dot dot--${e.kind}`} />
                    <span className="history__scope">
                      {PHASE_LABELS[e.phase]} · {e.scope}
                    </span>
                    <span className="history__label muted small">
                      {e.label}
                    </span>
                    <span className="history__val">
                      {e.kind === "magnific"
                        ? `${e.credits ?? 0} cr`
                        : `$${(e.claudeCostUsd ?? 0).toFixed(4)}`}
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
