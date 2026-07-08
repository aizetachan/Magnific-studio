import { useEffect, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconX } from "@tabler/icons-react";

/**
 * First-run tutorial (§onboarding): a centered modal shown ONCE, right after
 * the working-folder choice. Each step = an image + what the user must do to
 * start working. Paginated (can go back); the primary close button only
 * appears on the last step; a subtle X in the corner allows skipping.
 */

const SEEN_KEY = "magnific-studio:tour-seen";

interface TourStep {
  image: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    image: "/tutorial-1.jpg",
    title: "Conecta tus cuentas",
    body:
      "Ve a Ajustes y conecta tu cuenta de Magnific (OAuth) — la generación de imagen y vídeo usa tus créditos — y pega tu API key de Claude, que dirige la historia. Ninguna de las dos sale de tu sesión.",
  },
  {
    image: "/tutorial-2.jpg",
    title: "De la idea al corto",
    body:
      "Trabaja por fases: Historia → Guion → Storyboard → Producción → Entrega. Valida cada fase para desbloquear la siguiente; todo lo que generes se guarda en tu carpeta de trabajo.",
  },
];

function seen(): boolean {
  try {
    return !!localStorage.getItem(SEEN_KEY);
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Open once the workdir choice exists (i.e., right after that modal) and
  // the tour hasn't been seen. Poll cheaply: the choice is set milliseconds
  // after mount in returning sessions, or after the user picks a folder.
  useEffect(() => {
    if (seen()) return;
    const check = () => {
      try {
        if (localStorage.getItem("magnific-studio:workdir-choice")) {
          setOpen(true);
          return true;
        }
      } catch {
        return true;
      }
      return false;
    };
    if (check()) return;
    const t = setInterval(() => {
      if (check()) clearInterval(t);
    }, 800);
    return () => clearInterval(t);
  }, []);

  if (!open) return null;

  const close = () => {
    markSeen();
    setOpen(false);
  };
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div className="detail-modal" role="dialog" aria-modal="true">
      <div className="detail-modal__panel tour-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tour-modal__x" aria-label="Saltar tutorial" onClick={close}>
          <IconX size={16} />
        </button>
        <img className="tour-modal__img" src={s.image} alt="" />
        <h3 className="tour-modal__title">{s.title}</h3>
        <p className="tour-modal__body muted">{s.body}</p>
        <div className="tour-modal__nav">
          <button
            className="action tour-modal__prev"
            style={{ visibility: step > 0 ? "visible" : "hidden" }}
            onClick={() => setStep((x) => Math.max(0, x - 1))}
          >
            <IconArrowLeft size={15} /> Anterior
          </button>
          <div className="tour-modal__dots">
            {STEPS.map((_, i) => (
              <span key={i} className={`tour-modal__dot ${i === step ? "is-on" : ""}`} />
            ))}
          </div>
          {last ? (
            <button className="action action--gen" onClick={close}>
              Empezar a crear
            </button>
          ) : (
            <button
              className="action action--gen"
              onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))}
            >
              Siguiente <IconArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
