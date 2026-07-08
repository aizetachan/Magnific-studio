import { useEffect, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconX } from "@tabler/icons-react";
import { useI18n, type TKey } from "@/i18n";

/**
 * First-run tutorial (§onboarding): a centered modal shown ONCE, right after
 * the working-folder choice. Each step = an image + what the user must do to
 * start working. Paginated (can go back); the primary close button only
 * appears on the last step; a subtle X in the corner allows skipping.
 */

const SEEN_KEY = "magnific-studio:tour-seen";

interface TourStep {
  image: string;
  title: TKey;
  body: TKey;
}

const STEPS: TourStep[] = [
  { image: "/tutorial-1.png", title: "tour.s1.title", body: "tour.s1.body" },
  { image: "/tutorial-2.png", title: "tour.s2.title", body: "tour.s2.body" },
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
  const { t } = useI18n();

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
        <button className="tour-modal__x" aria-label={t("tour.skip")} onClick={close}>
          <IconX size={16} />
        </button>
        <img className="tour-modal__img" src={s.image} alt="" />
        <h3 className="tour-modal__title">{t(s.title)}</h3>
        <p className="tour-modal__body muted">{t(s.body)}</p>
        <div className="tour-modal__nav">
          <button
            className="action tour-modal__prev"
            style={{ visibility: step > 0 ? "visible" : "hidden" }}
            onClick={() => setStep((x) => Math.max(0, x - 1))}
          >
            <IconArrowLeft size={15} /> {t("tour.prev")}
          </button>
          <div className="tour-modal__dots">
            {STEPS.map((_, i) => (
              <span key={i} className={`tour-modal__dot ${i === step ? "is-on" : ""}`} />
            ))}
          </div>
          {last ? (
            <button className="action action--gen" onClick={close}>
              {t("tour.start")}
            </button>
          ) : (
            <button
              className="action action--gen"
              onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))}
            >
              {t("tour.next")} <IconArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
