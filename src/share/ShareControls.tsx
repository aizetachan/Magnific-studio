import { useState } from "react";
import { IconUsers, IconUserPlus, IconX } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { useStore } from "@/state/ProjectStore";
import { me, shareEnabled } from "./db";
import { sendInvite } from "./invites";
import { getPresence, subscribePresence } from "./useShareSync";
import { useI18n } from "@/i18n";

function randomRoomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Live avatars of the people in this project's room. */
export function PresenceAvatars() {
  const presence = useSyncExternalStore(subscribePresence, getPresence);
  const user = me();
  const others = presence.filter((p) => p.uid !== user?.uid);
  if (others.length === 0) return null;
  return (
    <div className="share-presence" title={others.map((p) => p.email).join(", ")}>
      {others.slice(0, 4).map((p) => (
        <span className="share-presence__avatar" key={p.uid}>
          {(p.email || "?").slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

/** "Compartir" — turns the project into a shared room and invites by email. */
export function ShareControls() {
  const { project, update } = useStore();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { t } = useI18n();
  const user = me();
  if (!shareEnabled || !user) return null;

  const invite = async () => {
    const to = email.trim();
    if (!to) return;
    setMsg(null);
    try {
      let roomId = project.share?.roomId;
      if (!roomId) {
        roomId = randomRoomId();
        const ownerUid = user.uid;
        update((d) => {
          d.share = { roomId: roomId!, ownerUid };
        });
      }
      await sendInvite({
        projectId: project.id,
        projectName: project.name,
        roomId,
        toEmail: to,
      });
      setEmail("");
      setMsg(t("share.invited", { email: to }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PresenceAvatars />
      <button
        className="icon-btn"
        title={project.share ? t("share.buttonShared") : t("share.button")}
        onClick={() => setOpen(true)}
      >
        <IconUsers size={16} />
      </button>
      {open ? (
        <div className="detail-modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="detail-modal__panel confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-modal__title">{t("share.title")} «{project.name}»</h3>
            <div className="confirm-modal__msg">
              <p className="muted small">{t("share.lead")}</p>
              <div className="share-invite-row">
                <input
                  type="email"
                  placeholder="email@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void invite()}
                />
                <button className="action action--gen" onClick={() => void invite()}>
                  <IconUserPlus size={15} /> {t("share.invite")}
                </button>
              </div>
              {msg ? <p className="small muted">{msg}</p> : null}
            </div>
            <div className="confirm-modal__actions">
              <button className="action" onClick={() => setOpen(false)}>
                <IconX size={14} /> {t("share.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
