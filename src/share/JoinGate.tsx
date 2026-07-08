import { useEffect, useState } from "react";
import { IconClockPause, IconDoorEnter, IconX } from "@tabler/icons-react";
import type { Project } from "@/types/project";
import { useStore } from "@/state/ProjectStore";
import { createBlankProject } from "@/state/seed";
import { saveProject, loadProject } from "@/state/persistence";
import { me, shareEnabled } from "./db";
import {
  createKnock,
  resolveLink,
  watchKnock,
  type Knock,
  type ShareLink,
} from "./links";
import { useI18n } from "@/i18n";
import { watchAuth } from "@/auth/firebase";

/**
 * Handles ?join=<token> — the copy-link entry point.
 * "open" links join directly; "approval" links create a knock and show a
 * waiting screen that auto-enters the moment the owner approves (the room
 * key only arrives inside the approved knock).
 */

const PENDING_JOIN = "magnific-studio:pending-join";

// Pin the token the moment this module loads, BEFORE any login redirect or
// URL normalization can touch the query string.
try {
  const early = new URL(window.location.href).searchParams.get("join");
  if (early) sessionStorage.setItem(PENDING_JOIN, early);
} catch {
  /* ignore */
}

function consumeJoinToken(): string | null {
  try {
    return (
      new URL(window.location.href).searchParams.get("join") ??
      sessionStorage.getItem(PENDING_JOIN)
    );
  } catch {
    return null;
  }
}

function forgetJoinToken(): void {
  try {
    sessionStorage.removeItem(PENDING_JOIN);
  } catch {
    /* ignore */
  }
}

function clearJoinParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState({}, "", url);
  } catch {
    /* ignore */
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; link: ShareLink }
  | { kind: "rejected"; link: ShareLink }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "error"; detail: string };

export function JoinGate() {
  const { switchProject } = useStore();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const { t } = useI18n();

  // Re-check when auth resolves (the link may be opened before signing in).
  const [authTick, setAuthTick] = useState(0);
  useEffect(() => watchAuth(() => setAuthTick((x) => x + 1)), []);

  useEffect(() => {
    const token = consumeJoinToken();
    if (!token || !shareEnabled || !me()) return;

    let unwatch: (() => void) | null = null;

    const enter = (projectId: string, projectName: string, roomId: string, ownerUid: string) => {
      const existing = loadProject(projectId);
      if (!existing) {
        const stub: Project = createBlankProject(projectName);
        stub.id = projectId;
        stub.share = { roomId, ownerUid };
        saveProject(stub);
      }
      clearJoinParam();
      forgetJoinToken();
      setPhase({ kind: "idle" });
      switchProject(projectId);
      // The dashboard hosts this gate too — jump into the studio view.
      window.dispatchEvent(new Event("ms:enter-studio"));
    };

    void (async () => {
      try {
      const link = await resolveLink(token);
      if (!link) {
        forgetJoinToken();
        setPhase({ kind: "invalid" });
        return;
      }
      if (link.exp && Date.now() > link.exp) {
        setPhase({ kind: "expired" });
        return;
      }
      const user = me();
      if (!user) return;
      if (link.ownerUid === user.uid) {
        clearJoinParam();
        forgetJoinToken();
        return; // it's your own link
      }
      if (link.mode === "open" && link.roomId) {
        enter(link.projectId, link.projectName, link.roomId, link.ownerUid);
        return;
      }
      // Approval mode: knock and wait (an earlier approval enters directly).
      const id = await createKnock(link);
      setPhase({ kind: "waiting", link });
      unwatch = watchKnock(id, (k: Knock | null) => {
        if (!k) return;
        if (k.status === "approved" && k.roomId) {
          unwatch?.();
          enter(k.projectId, k.projectName, k.roomId, k.ownerUid);
        } else if (k.status === "rejected") {
          setPhase({ kind: "rejected", link });
        }
      });
      } catch (e) {
        // Surface the failure instead of dying silently (rules, network...).
        console.error("[join] failed:", e);
        setPhase({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => unwatch?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authTick]);

  if (phase.kind === "idle") return null;

  return (
    <div className="detail-modal" role="dialog" aria-modal="true">
      <div className="detail-modal__panel confirm-modal">
        {phase.kind === "waiting" ? (
          <>
            <h3 className="confirm-modal__title">
              <IconClockPause size={18} style={{ verticalAlign: "-3px" }} />{" "}
              {t("join.waitingTitle")}
            </h3>
            <div className="confirm-modal__msg">
              <p>
                «{phase.link.projectName}»: {t("join.waitingBody")}{" "}
                <b>{phase.link.ownerName}</b>.
              </p>
              <p className="muted small">{t("join.waitingHint")}</p>
            </div>
            <div className="confirm-modal__actions">
              <span className="spin" />
            </div>
          </>
        ) : phase.kind === "rejected" ? (
          <>
            <h3 className="confirm-modal__title">
              <IconX size={18} style={{ verticalAlign: "-3px" }} /> {t("join.rejectedTitle")}
            </h3>
            <div className="confirm-modal__msg">
              <p>{t("join.rejectedBody")}</p>
            </div>
            <div className="confirm-modal__actions">
              <button className="action" onClick={() => { clearJoinParam(); forgetJoinToken(); setPhase({ kind: "idle" }); }}>
                {t("alert.close")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="confirm-modal__title">
              <IconDoorEnter size={18} style={{ verticalAlign: "-3px" }} />{" "}
              {phase.kind === "expired" ? t("join.expiredTitle") : t("join.invalidTitle")}
            </h3>
            <div className="confirm-modal__msg">
              <p>{phase.kind === "expired" ? t("join.expiredBody") : t("join.invalidBody")}</p>
              {phase.kind === "error" ? <p className="muted small">{phase.detail}</p> : null}
            </div>
            <div className="confirm-modal__actions">
              <button className="action" onClick={() => { clearJoinParam(); forgetJoinToken(); setPhase({ kind: "idle" }); }}>
                {t("alert.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
