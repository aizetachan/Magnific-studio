import { useEffect, useState } from "react";
import { IconCheck, IconSettings, IconX } from "@tabler/icons-react";
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
  const { project, update } = useStore();
  const s = project.settings;
  const t = totals(project);
  const byPhase = creditsByPhase(project);
  const [testing, setTesting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setConnError(null);
    try {
      const client = new AnthropicClient(s.anthropicApiKey, s.directorModel);
      if (!client.hasKey) {
        setConnError("Falta la API key.");
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
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e));
      update((d) => {
        d.settings.connectionTested = "failed";
      });
    } finally {
      setTesting(false);
    }
  };

  // Auto-validate the Claude key as soon as it's entered/changed (no need to
  // press the button), so the connection status is always shown visually.
  useEffect(() => {
    if (s.anthropicApiKey && s.connectionTested === "untested") {
      const id = setTimeout(() => void testConnection(), 600);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.anthropicApiKey, s.connectionTested]);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1><IconSettings size={24} /> Ajustes</h1>
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
              className={`conn conn--${testing ? "untested" : s.connectionTested}`}
            >
              {testing ? (
                "Validando…"
              ) : s.connectionTested === "ok" ? (
                <>
                  <IconCheck size={14} /> Claude conectado
                </>
              ) : s.connectionTested === "failed" ? (
                <>
                  <IconX size={14} /> Sin conexión
                </>
              ) : (
                "Sin probar"
              )}
            </span>
          </div>
          {connError && s.connectionTested === "failed" ? (
            <p className="muted small" style={{ color: "var(--err, #d05656)" }}>
              {connError.includes("401") || /x-api-key/i.test(connError)
                ? "La API key no es válida. Revísala (sin espacios) en console.anthropic.com."
                : /404|not_found|model/i.test(connError)
                  ? `El modelo "${s.directorModel}" no está disponible en tu cuenta. Prueba otro modelo.`
                  : connError}
            </p>
          ) : null}
        </div>

        <div className="card">
          <label className="card__label">Magnific (generación)</label>
          <p className="muted small">
            Conecta tu cuenta de Magnific por <b>MCP (OAuth)</b>: la generación
            usa tus propios créditos. Es el camino principal y recomendado.
          </p>

          <MagnificAuth />

          <p className="muted small" style={{ marginTop: 14 }}>
            Generación{" "}
            {config.magnificLive ? (
              <b className="ok">en vivo</b>
            ) : (
              <b>simulada</b>
            )}
            . El backend ejecuta las herramientas del MCP de Magnific con tu
            sesión OAuth y descarga cada resultado a este equipo.
            {config.magnificLive ? null : (
              <>
                {" "}
                Para llamadas reales: arranca el server con{" "}
                <code>MAGNIFIC_MCP_URL=https://mcp.magnific.com</code> y la app
                con <code>VITE_MAGNIFIC_LIVE=true</code>.
              </>
            )}
          </p>
          <ul className="meta-list">
            <li>
              <span>McpTransport</span>
              <b className="ok">sano</b>
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

/**
 * Per-user Magnific account connection via the Director backend's OAuth flow
 * (discovery + dynamic client registration + PKCE). Each user connects their
 * own account; the backend holds the tokens and runs the MCP loop server-side.
 */
interface Account {
  plan?: { tier?: string; productName?: string; isUnlimitedMode?: boolean };
  credits?: { available?: number; totalPlan?: number; spent?: number };
}

function MagnificAuth() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const base = config.directorBase;

  const refresh = async () => {
    try {
      const res = await fetch(`${base}/auth/status`, { credentials: "include" });
      const data = (await res.json()) as { connected: boolean; configured: boolean };
      setConnected(data.connected);
      setConfigured(data.configured);
      if (data.connected) {
        fetch(`${base}/account`, { credentials: "include" })
          .then((r) => r.json())
          .then((a) => a.ok && setAccount(a))
          .catch(() => {});
      }
    } catch {
      setConnected(false);
      setConfigured(false);
    }
  };

  useEffect(() => {
    // Surface the OAuth return and clean the URL.
    const params = new URLSearchParams(window.location.search);
    const status = params.get("magnific");
    if (status === "connected") setMsg("Cuenta de Magnific conectada.");
    else if (status === "unconfigured")
      setMsg("El backend no tiene MAGNIFIC_MCP_URL configurado.");
    else if (status === "error")
      setMsg(`No se pudo conectar: ${params.get("detail") ?? "error"}`);
    if (status) {
      params.delete("magnific");
      params.delete("detail");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await fetch(`${base}/auth/logout`, { method: "POST", credentials: "include" });
    void refresh();
  };

  return (
    <div className="oauth">
      <div className="kf__row">
        <span className="card__label" style={{ margin: 0 }}>
          Mi cuenta de Magnific (MCP · OAuth)
        </span>
        <span className={`conn conn--${connected ? "ok" : "untested"}`}>
          {connected === null ? (
            "…"
          ) : connected ? (
            <>
              <IconCheck size={14} /> Conectada
            </>
          ) : (
            "No conectada"
          )}
        </span>
      </div>
      <div className="kf__row" style={{ marginTop: 8 }}>
        {connected ? (
          <button className="mini" onClick={logout}>
            Desconectar
          </button>
        ) : (
          <button
            className="gate"
            style={{ height: 36 }}
            disabled={connecting}
            onClick={() => {
              setConnecting(true);
              setMsg("Redirigiendo a Magnific para autorizar…");
              window.location.href = `${base}/auth/login`;
            }}
          >
            {connecting ? "Redirigiendo a Magnific…" : "Conectar mi cuenta de Magnific"}
          </button>
        )}
        {!configured ? (
          <span className="muted small">backend sin MAGNIFIC_MCP_URL</span>
        ) : null}
      </div>
      {connected && account ? (
        <div className="balance">
          {account.plan?.productName || account.plan?.tier ? (
            <div className="balance__row">
              <span className="balance__label">Plan</span>
              <span className="balance__val">
                {account.plan.productName ?? account.plan.tier}
                {account.plan.isUnlimitedMode ? " · ilimitado" : ""}
              </span>
            </div>
          ) : null}
          {account.credits?.available !== undefined ? (
            <div className="balance__row">
              <span className="balance__label">Créditos disponibles</span>
              <span className="balance__val">
                {account.credits.available.toLocaleString("es-ES")}
                {account.credits.totalPlan
                  ? ` / ${account.credits.totalPlan.toLocaleString("es-ES")}`
                  : ""}
              </span>
            </div>
          ) : null}
          {account.credits?.spent !== undefined ? (
            <div className="balance__row">
              <span className="balance__label">Gastados</span>
              <span className="balance__val">
                {account.credits.spent.toLocaleString("es-ES")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {msg ? <p className="muted small">{msg}</p> : null}
    </div>
  );
}
