import { useEffect, useState } from "react";
import { IconAlertTriangle, IconPlugConnected } from "@tabler/icons-react";

/**
 * In-app replacement for the browser's native alert(): a platform-styled
 * modal. When the message is the "connect your Claude API key" one, it also
 * offers a CTA that jumps straight to Ajustes → Claude (API).
 *
 * Use showAppAlert(msg) anywhere (no React context needed).
 */

const EVT = "ms:app-alert";
/** Session flag read by HomeShell/SettingsPage to land on the API section. */
const GOTO_KEY = "magnific-studio:goto-settings";

export function showAppAlert(message: string): void {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { message } }));
}

/** Jump to Ajustes → Claude (API), from anywhere in the app. */
export function openSettingsApi(): void {
  try {
    sessionStorage.setItem(GOTO_KEY, "claude");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("ms:open-settings"));
}

/** Read+consume the pending settings target ("claude") if any. */
export function consumeSettingsTarget(): string | null {
  try {
    const v = sessionStorage.getItem(GOTO_KEY);
    if (v) sessionStorage.removeItem(GOTO_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Peek without consuming (for intermediate hops like HomeShell). */
export function peekSettingsTarget(): string | null {
  try {
    return sessionStorage.getItem(GOTO_KEY);
  } catch {
    return null;
  }
}

const NEEDS_API = (msg: string) =>
  /conecta tu api|api key de claude|api de claude/i.test(msg);

export function AppAlert() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onAlert = (e: Event) => {
      const msg = (e as CustomEvent<{ message?: string }>).detail?.message;
      if (msg) setMessage(msg);
    };
    window.addEventListener(EVT, onAlert);
    return () => window.removeEventListener(EVT, onAlert);
  }, []);

  if (!message) return null;
  const needsApi = NEEDS_API(message);

  return (
    <div className="detail-modal" role="alertdialog" aria-modal="true" onClick={() => setMessage(null)}>
      <div className="detail-modal__panel confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-modal__title">
          <IconAlertTriangle size={18} style={{ verticalAlign: "-3px" }} />{" "}
          {needsApi ? "Falta conectar Claude" : "Aviso"}
        </h3>
        <div className="confirm-modal__msg">
          <p>{message}</p>
          {needsApi ? (
            <p className="muted small">
              El Director usa tu propia API key de Anthropic. Se guarda solo en
              tu sesión y nunca sale de tu navegador.
            </p>
          ) : null}
        </div>
        <div className="confirm-modal__actions">
          <button className="action" onClick={() => setMessage(null)}>
            Cerrar
          </button>
          {needsApi ? (
            <button
              className="action action--gen"
              onClick={() => {
                setMessage(null);
                openSettingsApi();
              }}
            >
              <IconPlugConnected size={15} /> Conectar API de Claude
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
