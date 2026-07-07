import { useEffect, useState, type ComponentType } from "react";
import {
  IconAdjustmentsHorizontal,
  IconBolt,
  IconBuildingSkyscraper,
  IconChartBar,
  IconCheck,
  IconCode,
  IconCreditCard,
  IconLock,
  IconShieldLock,
  IconSparkles,
  IconUser,
  IconUsers,
  IconX,
  type IconProps,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useCredentials, setCredentials } from "@/state/credentials";
import { AnthropicClient } from "@/director/AnthropicClient";
import { config } from "@/config";
import {
  PHASE_LABELS,
  creditsByPhase,
  totals,
} from "@/state/consumption";

const MODELS = ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];

type Sec =
  | "perfil" | "prefs" | "seguridad"
  | "claude" | "magnific"
  | "uso"
  | "team" | "people" | "apikeys" | "sso" | "billing";

const NAV: { group: string; items: { id: Sec; label: string; icon: ComponentType<IconProps>; mock?: boolean }[] }[] = [
  { group: "Cuenta", items: [
    { id: "perfil", label: "Perfil", icon: IconUser, mock: true },
    { id: "prefs", label: "Preferencias", icon: IconAdjustmentsHorizontal, mock: true },
    { id: "seguridad", label: "Seguridad", icon: IconLock, mock: true },
  ]},
  { group: "Conexiones", items: [
    { id: "claude", label: "Claude (API)", icon: IconSparkles },
    { id: "magnific", label: "Magnific (MCP)", icon: IconBolt },
  ]},
  { group: "Uso", items: [
    { id: "uso", label: "Consumo", icon: IconChartBar },
  ]},
  { group: "Organización", items: [
    { id: "team", label: "My Team", icon: IconBuildingSkyscraper, mock: true },
    { id: "people", label: "People", icon: IconUsers, mock: true },
    { id: "apikeys", label: "API Keys", icon: IconCode, mock: true },
    { id: "sso", label: "Security SSO", icon: IconShieldLock, mock: true },
    { id: "billing", label: "Plan & billing", icon: IconCreditCard, mock: true },
  ]},
];
const SEC_LABEL: Record<Sec, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])),
) as Record<Sec, string>;

/**
 * Settings (§5.3) — connect your own Anthropic API key, see exactly what you
 * consume (Claude tokens/cost + Magnific credits with preflight), and manage the
 * shared library. The API key lives only in memory and is never exported.
 */
export function SettingsPage() {
  const { project } = useStore();
  // Anthropic key / model / status are GLOBAL (shared by every project), so
  // connecting here works in any project opened in the Studio.
  const creds = useCredentials();
  const t = totals(project);
  const byPhase = creditsByPhase(project);
  const [testing, setTesting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [section, setSection] = useState<Sec>("perfil");
  // Mock profile fields (visual only, not persisted).
  const [profile, setProfile] = useState({ name: "", username: "", email: "" });

  const testConnection = async () => {
    setTesting(true);
    setConnError(null);
    try {
      const client = new AnthropicClient(creds.anthropicApiKey, creds.directorModel);
      if (!client.hasKey) {
        setConnError("Falta la API key.");
        setCredentials({ connectionTested: "failed" });
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
      setCredentials({ connectionTested: "ok" });
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e));
      setCredentials({ connectionTested: "failed" });
    } finally {
      setTesting(false);
    }
  };


  return (
    <div className="settings">
      <div className="settings__layout">
        <aside className="settings__nav">
          {NAV.map((g) => (
            <div className="settings__group" key={g.group}>
              <div className="settings__grouplabel">{g.group}</div>
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    className={`settings__navitem ${section === it.id ? "is-on" : ""}`}
                    onClick={() => setSection(it.id)}
                  >
                    <Icon size={16} />
                    <span>{it.label}</span>
                    {it.mock ? <span className="settings__soon">pronto</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <div className="settings__body">
          <h1 className="settings__title">{SEC_LABEL[section]}</h1>

          {/* ---------- Conexiones · Claude (real) ---------- */}
          {section === "claude" ? (
            <div className="card">
              <label className="card__label">API de Anthropic (Claude)</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={creds.anthropicApiKey}
                onChange={(e) =>
                  setCredentials({ anthropicApiKey: e.target.value, connectionTested: "untested" })
                }
              />
              <p className="muted small">
                Se guarda solo en memoria de la sesión. Nunca se exporta ni se
                hardcodea.
              </p>
              <label className="card__label">Modelo del director</label>
              <select
                value={creds.directorModel}
                onChange={(e) => setCredentials({ directorModel: e.target.value })}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div className="conn-row">
                <span
                  className={`conn conn--${testing ? "untested" : creds.connectionTested}`}
                >
                  {testing ? (
                    "Validando…"
                  ) : creds.connectionTested === "ok" ? (
                    <>
                      <IconCheck size={14} /> Claude conectado
                    </>
                  ) : creds.connectionTested === "failed" ? (
                    <>
                      <IconX size={14} /> Sin conexión
                    </>
                  ) : (
                    "Sin probar"
                  )}
                </span>
                <button className="action action--gen" disabled={testing} onClick={testConnection}>
                  {testing ? "Probando…" : "Comprobar conexión"}
                </button>
              </div>
              {connError && creds.connectionTested === "failed" ? (
                <p className="muted small" style={{ color: "var(--err, #d05656)" }}>
                  {connError.includes("401") || /x-api-key/i.test(connError)
                    ? "La API key no es válida. Revísala (sin espacios) en console.anthropic.com."
                    : /404|not_found|model/i.test(connError)
                      ? `El modelo "${creds.directorModel}" no está disponible en tu cuenta. Prueba otro modelo.`
                      : connError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* ---------- Conexiones · Magnific (real) ---------- */}
          {section === "magnific" ? (
            <div className="card">
              <label className="card__label">Magnific (generación)</label>
              <p className="muted small">
                Conecta tu cuenta de Magnific por <b>MCP (OAuth)</b>: la
                generación usa tus propios créditos. Es el camino principal y
                recomendado.
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
                    <code>MAGNIFIC_MCP_URL=https://mcp.magnific.com</code> y la
                    app con <code>VITE_MAGNIFIC_LIVE=true</code>.
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
          ) : null}

          {/* ---------- Uso · Consumo (real) ---------- */}
          {section === "uso" ? (
            <>
              <div className="settings__row2">
                <div className="card">
                  <label className="card__label">Consumo de Claude</label>
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
            </>
          ) : null}

          {/* ---------- Cuenta · Perfil (mock) ---------- */}
          {section === "perfil" ? (
            <div className="card">
              <div className="settings__avatar-row">
                <div className="settings__avatar">
                  {(profile.name || "S").trim().charAt(0).toUpperCase()}
                </div>
                <button className="mini" disabled>
                  Cambiar avatar
                </button>
              </div>
              <label className="card__label">Nombre</label>
              <input
                placeholder="Santi"
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              />
              <label className="card__label">Username</label>
              <input
                placeholder="santi"
                value={profile.username}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, username: e.target.value }))
                }
              />
              <label className="card__label">Email</label>
              <input
                placeholder="santi@example.com"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
              />
              <p className="muted small">
                Perfil de demostración — todavía no se persiste.
              </p>
            </div>
          ) : null}

          {/* ---------- Cuenta · Preferencias (mock) ---------- */}
          {section === "prefs" ? (
            <div className="card">
              <label className="card__label">Idioma</label>
              <select disabled defaultValue="es">
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
              <label className="card__label">Tema</label>
              <select disabled defaultValue="dark">
                <option value="dark">Oscuro</option>
                <option value="light">Claro</option>
              </select>
              <p className="muted small">Mock — se cableará más adelante.</p>
            </div>
          ) : null}

          {/* ---------- Cuenta · Seguridad (mock) ---------- */}
          {section === "seguridad" ? (
            <div className="card">
              <label className="card__label">Contraseña</label>
              <div className="kf__row">
                <span className="muted small">
                  Mantén tu cuenta segura con una contraseña fuerte.
                </span>
                <button className="mini" disabled>
                  Cambiar contraseña
                </button>
              </div>
              <label className="card__label">Verificación en dos pasos</label>
              <div className="kf__row">
                <span className="muted small">2FA desactivado.</span>
                <button className="mini" disabled>
                  Activar 2FA
                </button>
              </div>
              <p className="muted small">Mock — pendiente de backend de cuentas.</p>
            </div>
          ) : null}

          {/* ---------- Organización (mock) ---------- */}
          {section === "team" ||
          section === "people" ||
          section === "apikeys" ||
          section === "sso" ||
          section === "billing" ? (
            <div className="card settings__mock">
              <p className="muted">
                <b>{SEC_LABEL[section]}</b> — sección de organización en
                construcción.
              </p>
              <p className="muted small">
                Reservada para la gestión de equipo (miembros, claves de API,
                SSO y facturación). Aún no conectada.
              </p>
            </div>
          ) : null}
        </div>
      </div>
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
