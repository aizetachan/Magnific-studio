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
  IconUser,
  IconUsers,
  IconX,
  type IconProps,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useCredentials, setCredentials } from "@/state/credentials";
import { AnthropicClient } from "@/director/AnthropicClient";
import { OpenAIClient, OPENAI_MODELS } from "@/director/OpenAIClient";
import { authEnabled, watchAuth } from "@/auth/firebase";
import type { User } from "firebase/auth";
import { useMyCollaborators, useMyPendingKnocks } from "@/share/useKnocks";
import { KnockRow } from "@/share/ShareControls";
import { loadProject } from "@/state/persistence";
import { config } from "@/config";
import { consumeSettingsTarget } from "@/components/AppAlert";
import { setLang, useI18n, type TKey } from "@/i18n";
import { Select } from "@/components/Select";
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

const NAV: { group: TKey; items: { id: Sec; label: string; labelKey?: TKey; icon: ComponentType<IconProps>; mock?: boolean }[] }[] = [
  { group: "settings.group.account", items: [
    { id: "perfil", label: "Perfil", labelKey: "settings.nav.profile", icon: IconUser },
    { id: "prefs", label: "Preferencias", labelKey: "settings.nav.prefs", icon: IconAdjustmentsHorizontal },
    { id: "seguridad", label: "Seguridad", labelKey: "settings.nav.security", icon: IconLock, mock: true },
    { id: "people", label: "Collaborators", labelKey: "settings.nav.collaborators", icon: IconUsers },
    { id: "billing", label: "Plan & billing", icon: IconCreditCard, mock: true },
  ]},
  { group: "settings.group.connections", items: [
    { id: "claude", label: "API Keys", labelKey: "settings.nav.claude", icon: IconCode },
    { id: "magnific", label: "Magnific (MCP)", labelKey: "settings.nav.magnific", icon: IconBolt },
  ]},
  { group: "settings.group.usage", items: [
    { id: "uso", label: "Consumo", labelKey: "settings.nav.usage", icon: IconChartBar },
  ]},
  { group: "settings.group.org", items: [
    { id: "team", label: "My Team", icon: IconBuildingSkyscraper, mock: true },
    { id: "sso", label: "Security SSO", icon: IconShieldLock, mock: true },
  ]},
];
/** Compact brand logomarks for the provider switch. */
function ClaudeLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.7 6.1L19 5.2l-3.4 5.1L21.5 12l-5.9 1.7L19 18.8l-5.3-2.9L12 22l-1.7-6.1L5 18.8l3.4-5.1L2.5 12l5.9-1.7L5 5.2l5.3 2.9L12 2z" />
    </svg>
  );
}
function OpenAILogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .75 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.37-1.97v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 14.02a4.5 4.5 0 0 1-1.66-6.13zm16.6 3.86l-5.83-3.39 2.01-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.66zm2.01-3.02l-.14-.09-4.77-2.79a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.14l-2.02-1.16a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.47a.79.79 0 0 0-.39.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
    </svg>
  );
}

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
  const { lang, t: tr } = useI18n();
  // Anthropic key / model / status are GLOBAL (shared by every project), so
  // connecting here works in any project opened in the Studio.
  const creds = useCredentials();
  const t = totals(project);
  const byPhase = creditsByPhase(project);
  const [testing, setTesting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [section, setSection] = useState<Sec>("perfil");
  // Deep link from the connect-API modal: land directly on Claude (API).
  useEffect(() => {
    if (consumeSettingsTarget() === "claude") setSection("claude");
    const go = () => {
      if (consumeSettingsTarget() === "claude") setSection("claude");
    };
    window.addEventListener("ms:open-settings", go);
    return () => window.removeEventListener("ms:open-settings", go);
  }, []);
  // Profile: real data from the signed-in Google account; the username is
  // user-editable and remembered in this browser (defaults to the name).
  const [gUser, setGUser] = useState<User | null>(null);
  useEffect(() => (authEnabled ? watchAuth(setGUser) : undefined), []);
  const USERNAME_KEY = "magnific-studio:username";
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(USERNAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (gUser && !username) setUsername(gUser.displayName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gUser]);
  const saveUsername = (v: string) => {
    setUsername(v);
    try {
      localStorage.setItem(USERNAME_KEY, v);
    } catch {
      /* ignore */
    }
  };
  // Collaborators management (pending + with access).
  const pendingKnocks = useMyPendingKnocks();
  const collaborators = useMyCollaborators();

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

  const testOpenAI = async () => {
    setTesting(true);
    setConnError(null);
    try {
      const client = new OpenAIClient(creds.openaiApiKey, creds.openaiModel);
      if (!client.hasKey) {
        setConnError("Falta la API key.");
        setCredentials({ openaiTested: "failed" });
        return;
      }
      await client.send(
        { phase: "story", phaseLabel: "Test", visibleObjects: {}, allowedActions: [], blockedActions: [], implicitReferent: "test" },
        [{ role: "user", content: "ping" }],
        () => "pong",
        16,
      );
      setCredentials({ openaiTested: "ok" });
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e));
      setCredentials({ openaiTested: "failed" });
    } finally {
      setTesting(false);
    }
  };

  const provider = creds.provider;
  const provTested = provider === "openai" ? creds.openaiTested : creds.connectionTested;


  return (
    <div className="settings">
      <div className="settings__layout">
        <aside className="settings__nav">
          {NAV.map((g) => (
            <div className="settings__group" key={g.group}>
              <div className="settings__grouplabel">{tr(g.group)}</div>
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    className={`settings__navitem ${section === it.id ? "is-on" : ""} ${it.mock ? "settings__navitem--soon" : ""}`}
                    disabled={it.mock}
                    onClick={() => setSection(it.id)}
                  >
                    <Icon size={16} />
                    <span>{it.labelKey ? tr(it.labelKey) : it.label}</span>
                    {it.mock ? <span className="home__soon">{tr("common.soon")}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <div className="settings__body">
          <h1 className="settings__title">{(() => { const it = NAV.flatMap((g) => g.items).find((i) => i.id === section); return it?.labelKey ? tr(it.labelKey) : SEC_LABEL[section]; })()}</h1>

          {/* ---------- Cuenta · Preferencias (real: idioma) ---------- */}
          {section === "prefs" ? (
            <div className="card">
              <label className="card__label">{tr("settings.prefs.lang")}</label>
              <Select
                value={lang}
                onChange={(v) => setLang(v as "en" | "es")}
                options={[
                  { value: "en", label: tr("settings.lang.en") },
                  { value: "es", label: tr("settings.lang.es") },
                ]}
              />
              <p className="muted small">{tr("settings.prefs.langHelp")}</p>
            </div>
          ) : null}

          {/* ---------- Conexiones · Claude (real) ---------- */}
          {section === "claude" ? (
            <div className="card">
              {/* Provider switch: which API drives the Director. */}
              <div className="apiprov">
                <button
                  className={`apiprov__btn ${provider === "anthropic" ? "apiprov__btn--on" : ""}`}
                  onClick={() => setCredentials({ provider: "anthropic" })}
                >
                  <ClaudeLogo /> Claude
                </button>
                <button
                  className={`apiprov__btn ${provider === "openai" ? "apiprov__btn--on" : ""}`}
                  onClick={() => setCredentials({ provider: "openai" })}
                >
                  <OpenAILogo /> OpenAI
                </button>
              </div>

              <label className="card__label">{tr("settings.apiKeyLabel")}</label>
              {provider === "anthropic" ? (
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={creds.anthropicApiKey}
                  onChange={(e) =>
                    setCredentials({ anthropicApiKey: e.target.value, connectionTested: "untested" })
                  }
                />
              ) : (
                <input
                  type="password"
                  placeholder="sk-..."
                  value={creds.openaiApiKey}
                  onChange={(e) =>
                    setCredentials({ openaiApiKey: e.target.value, openaiTested: "untested" })
                  }
                />
              )}
              <p className="muted small">
                {tr("settings.apiHelp")}{" "}
                <a
                  className="settings-help-link"
                  href={provider === "anthropic" ? "https://platform.claude.com/settings/workspaces/default/keys" : "https://platform.openai.com/api-keys"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("settings.apiWhere")}
                </a>
              </p>
              <label className="card__label">{tr("settings.model")}</label>
              {provider === "anthropic" ? (
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
              ) : (
                <select
                  value={creds.openaiModel}
                  onChange={(e) => setCredentials({ openaiModel: e.target.value, openaiTested: "untested" })}
                >
                  {OPENAI_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              <div className="conn-row">
                <span className={`conn conn--${testing ? "untested" : provTested}`}>
                  {testing ? (
                    tr("settings.testing")
                  ) : provTested === "ok" ? (
                    <>
                      <IconCheck size={14} /> {tr("settings.connected")}
                    </>
                  ) : provTested === "failed" ? (
                    <>
                      <IconX size={14} /> {tr("settings.noConn")}
                    </>
                  ) : (
                    tr("settings.untested")
                  )}
                </span>
                {provTested === "ok" && !testing ? (
                  <button
                    className="action action--muted"
                    onClick={() =>
                      provider === "openai"
                        ? setCredentials({ openaiApiKey: "", openaiTested: "untested" })
                        : setCredentials({ anthropicApiKey: "", connectionTested: "untested" })
                    }
                  >
                    {tr("settings.disconnectApi")}
                  </button>
                ) : (
                  <button
                    className="action action--primary"
                    disabled={testing}
                    onClick={provider === "openai" ? testOpenAI : testConnection}
                  >
                    {testing ? tr("settings.testing") : tr("settings.testConn")}
                  </button>
                )}
              </div>
              {connError && provTested === "failed" ? (
                <p className="muted small" style={{ color: "var(--err, #d05656)" }}>
                  {connError.includes("401") || /x-api-key|invalid_api_key/i.test(connError)
                    ? "La API key no es válida. Revísala (sin espacios)."
                    : /404|not_found|model/i.test(connError)
                      ? "El modelo seleccionado no está disponible en tu cuenta. Prueba otro modelo."
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
                {gUser?.photoURL ? (
                  <img className="settings__avatar settings__avatar--img" src={gUser.photoURL} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <div className="settings__avatar">
                    {(gUser?.displayName || username || "?").trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="muted small">Avatar de tu cuenta de Google.</span>
              </div>
              <label className="card__label">Nombre</label>
              <input value={gUser?.displayName ?? ""} readOnly disabled placeholder="—" />
              <label className="card__label">Username</label>
              <input
                placeholder="tu-nombre"
                value={username}
                onChange={(e) => saveUsername(e.target.value)}
              />
              <label className="card__label">Email</label>
              <input value={gUser?.email ?? ""} readOnly disabled placeholder="—" />
            </div>
          ) : null}

          {/* ---------- Cuenta · Colaboradores (real) ---------- */}
          {section === "people" ? (
            <div className="card">
              {pendingKnocks.length > 0 ? (
                <div className="share-modal__section">
                  <label className="card__label">{tr("share.pending")}</label>
                  {pendingKnocks.map((k) => (
                    <KnockRow key={k.id} k={k} roomId={loadProject(k.projectId)?.share?.roomId} showProject />
                  ))}
                </div>
              ) : null}
              {collaborators.length > 0 ? (
                <div className="share-modal__section">
                  <label className="card__label">{tr("collab.access")}</label>
                  {collaborators.map((c) => (
                    <div className="knock" key={c.key}>
                      {c.photo ? (
                        <img className="knock__avatar" src={c.photo} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="knock__avatar knock__avatar--initial">
                          {(c.name || c.email).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="knock__who">
                        <strong>{c.name || c.email}</strong>
                        <span className="muted small">
                          {c.email} · {tr("collab.accessTo")} <b>«{c.projectName}»</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {pendingKnocks.length === 0 && collaborators.length === 0 ? (
                <p className="muted">{tr("collab.empty")}</p>
              ) : null}
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
              <p className="muted small">Mock, pendiente de backend de cuentas.</p>
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
                <b>{SEC_LABEL[section]}</b>: sección de organización en
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
          <button className="action action--muted" onClick={logout}>
            Desconectar
          </button>
        ) : (
          <button
            className="action action--primary"
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
