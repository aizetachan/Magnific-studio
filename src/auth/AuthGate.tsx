import { useEffect, useState, type ReactNode } from "react";
import { IconBrandGoogleFilled, IconSparkles } from "@tabler/icons-react";
import type { User } from "firebase/auth";
import { authEnabled, loginWithGoogle, watchAuth } from "./firebase";

/**
 * Blocks the app behind Google login when Firebase is configured (prod).
 * In dev (no VITE_FIREBASE_* vars) it renders children directly — the app
 * behaves exactly like the local single-user version.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(authEnabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authEnabled) return;
    return watchAuth((u) => {
      setUser(u);
      setChecking(false);
    });
  }, []);

  if (!authEnabled) return <>{children}</>;
  if (checking) {
    return (
      <div className="auth-gate">
        <div className="auth-gate__card">
          <IconSparkles size={28} />
          <p className="muted">Cargando…</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="auth-gate">
        <div className="auth-gate__card">
          <IconSparkles size={28} />
          <h1>Magnific Studio</h1>
          <p className="muted">
            Inicia sesión para usar el estudio. Tu contenido se guarda solo en
            tu máquina (para esta versión alpha); conectarás tu propia cuenta
            de Magnific y tu API key de Claude en Ajustes.
          </p>
          <button
            className="action auth-gate__google"
            onClick={async () => {
              setError(null);
              try {
                await loginWithGoogle();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <IconBrandGoogleFilled size={16} /> Entrar con Google
          </button>
          {error ? <p className="auth-gate__err">{error}</p> : null}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
