import { useEffect, useState } from "react";
import { IconFolder, IconFolderOpen } from "@tabler/icons-react";
import {
  initLocalDir,
  localDirName,
  localDirStatus,
  pickDirectory,
  requestAccess,
  subscribeLocalDir,
  supportsLocalDir,
} from "@/state/localdir";
import { OnboardingToast } from "@/components/OnboardingToast";
import { useI18n } from "@/i18n";

/**
 * Local-first storage gate (§Fase 0). On first visit in a supported browser
 * (Chrome/Edge) it asks WHERE to save the user's work: a local working folder
 * (File System Access API) or just this browser (localStorage). If a folder was
 * linked before, it shows a one-click "reconnect" banner when the browser asks
 * for a permission re-grant. In fallback mode (Safari/Firefox or "browser
 * only") it warns before closing a tab with unexported changes.
 */

const CHOICE_KEY = "magnific-studio:workdir-choice";
type Choice = "folder" | "browser";

function getChoice(): Choice | null {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === "folder" || v === "browser" ? v : null;
  } catch {
    return null;
  }
}

export function WorkdirGate() {
  const [status, setStatus] = useState(localDirStatus());
  const [choice, setChoice] = useState<Choice | null>(getChoice());
  const { t } = useI18n();

  useEffect(() => {
    void initLocalDir().then(() => setStatus(localDirStatus()));
    return subscribeLocalDir(() => setStatus(localDirStatus()));
  }, []);

  const commit = (c: Choice) => {
    try {
      localStorage.setItem(CHOICE_KEY, c);
    } catch {
      /* ignore */
    }
    setChoice(c);
  };

  // Fallback mode = no working folder → warn before losing work on tab close.
  const fallback = !supportsLocalDir() || choice === "browser";
  useEffect(() => {
    if (!fallback) return;
    let dirty = false;
    const onSaved = () => (dirty = true);
    const onExported = () => (dirty = false);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      // Chrome requires returnValue to show the native dialog.
      e.returnValue = "";
    };
    window.addEventListener("ms:project-saved", onSaved);
    window.addEventListener("ms:exported", onExported);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("ms:project-saved", onSaved);
      window.removeEventListener("ms:exported", onExported);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [fallback]);

  // First-visit choice modal (only where the folder mode is available).
  if (supportsLocalDir() && !choice && status !== "ready") {
    return (
      <div className="detail-modal" role="dialog" aria-modal="true">
        <div className="detail-modal__panel confirm-modal">
          <h3 className="confirm-modal__title">{t("workdir.title")}</h3>
          <div className="confirm-modal__msg">
            <p>{t("workdir.body1")}</p>
            <p>{t("workdir.body2")}</p>
            <p className="muted small">{t("workdir.browserHint")}</p>
          </div>
          <div className="confirm-modal__actions">
            <button className="action" onClick={() => commit("browser")}>
              {t("workdir.browserOnly")}
            </button>
            <button
              className="action action--gen"
              onClick={async () => {
                if (await pickDirectory()) commit("folder");
              }}
            >
              <IconFolderOpen size={16} /> {t("workdir.pick")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Folder linked but the browser wants a re-grant (one click, new session).
  if (choice === "folder" && status === "needs-permission") {
    return (
      <div className="conn-banner" role="status">
        <IconFolder size={16} />
        <span>
          {t("workdir.reconnect")}{" "}
          {localDirName() ? <b>«{localDirName()}»</b> : null}
        </span>
        <button
          className="conn-banner__cta"
          onClick={() => void requestAccess()}
        >
          {t("workdir.reconnectCta")}
        </button>
      </div>
    );
  }

  // Folder mode chosen but the handle is gone (cleared site data) → re-pick.
  if (choice === "folder" && status === "unlinked") {
    return (
      <div className="conn-banner" role="status">
        <IconFolder size={16} />
        <span>{t("workdir.pickCta")}</span>
        <button
          className="conn-banner__cta"
          onClick={() => void pickDirectory()}
        >
          {t("workdir.pick")}
        </button>
      </div>
    );
  }

  // Fallback hint: work lives in this browser; export before closing.
  if (fallback) {
    return (
      <OnboardingToast storageKey="magnific-studio:onboard-fallback-save">
        {t("workdir.fallbackToast")}
      </OnboardingToast>
    );
  }

  return null;
}
