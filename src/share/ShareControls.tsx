import { useEffect, useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconLink,
  IconRefresh,
  IconUserPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { useStore } from "@/state/ProjectStore";
import { Select } from "@/components/Select";
import { me, shareEnabled } from "./db";
import { sendInvite } from "./invites";
import { getPresence, subscribePresence } from "./useShareSync";
import { approveKnock, createLink, linkUrl, rejectKnock, type Knock } from "./links";
import { useMyPendingKnocks } from "./useKnocks";
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

/** One pending join request row (used here and in the dashboard panel). */
export function KnockRow({ k, roomId, showProject }: { k: Knock; roomId?: string; showProject?: boolean }) {
  const { t } = useI18n();
  const canApprove = !!roomId;
  return (
    <div className="knock">
      {k.photo ? (
        <img className="knock__avatar" src={k.photo} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="knock__avatar knock__avatar--initial">
          {(k.name || k.email || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="knock__who">
        <strong>{k.name || k.email}</strong>
        <span className="muted small">
          {k.email}
          {showProject ? (
            <>
              {" "}
              · {t("collab.wants")} <b>«{k.projectName}»</b>
            </>
          ) : null}
        </span>
      </div>
      <button
        className="action action--gen knock__btn"
        disabled={!canApprove}
        onClick={() => canApprove && void approveKnock(k, roomId!)}
      >
        <IconCheck size={14} /> {t("share.approve")}
      </button>
      <button className="action knock__btn" onClick={() => void rejectKnock(k)}>
        <IconX size={14} /> {t("share.reject")}
      </button>
    </div>
  );
}

/** "Compartir" — invite by email, share by link, approve join requests. */
export function ShareControls() {
  const { project, update } = useStore();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"approval" | "open">("approval");
  const [expDays, setExpDays] = useState<string>("never");
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const knocks = useMyPendingKnocks();
  const fileKnocks = knocks.filter((k) => k.projectId === project.id);

  useEffect(() => {
    if (!copied) return;
    const to = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(to);
  }, [copied]);

  const user = me();
  if (!shareEnabled || !user) return null;

  /** The project's room id, creating the share record on first use. */
  const ensureRoom = (): string => {
    let roomId = project.share?.roomId;
    if (!roomId) {
      roomId = randomRoomId();
      const ownerUid = user.uid;
      update((d) => {
        d.share = { roomId: roomId!, ownerUid };
      });
    }
    return roomId;
  };

  const invite = async () => {
    const to = email.trim();
    if (!to) return;
    setMsg(null);
    try {
      const roomId = ensureRoom();
      await sendInvite({ projectId: project.id, projectName: project.name, roomId, toEmail: to });
      setEmail("");
      setMsg(t("share.invited", { email: to }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const copyLink = async (regenerate = false) => {
    setMsg(null);
    try {
      const roomId = ensureRoom();
      let token = project.share?.linkToken;
      if (!token || regenerate) {
        token = await createLink({
          projectId: project.id,
          projectName: project.name,
          roomId,
          mode,
          expDays: expDays === "never" ? null : Number(expDays),
          replaceToken: regenerate ? token : null,
        });
        update((d) => {
          if (d.share) d.share.linkToken = token;
        });
      }
      await navigator.clipboard.writeText(linkUrl(token));
      setCopied(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PresenceAvatars />
      <button
        className="icon-btn share-btn"
        title={project.share ? t("share.buttonShared") : t("share.button")}
        onClick={() => setOpen(true)}
      >
        <IconUsers size={16} />
        {fileKnocks.length > 0 ? <span className="badge-dot">{fileKnocks.length}</span> : null}
      </button>
      {open ? (
        <div className="detail-modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="detail-modal__panel confirm-modal share-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-modal__title">{t("share.title")} «{project.name}»</h3>
            <div className="confirm-modal__msg">
              {fileKnocks.length > 0 ? (
                <div className="share-modal__section">
                  <label className="card__label">{t("share.pending")}</label>
                  {fileKnocks.map((k) => (
                    <KnockRow key={k.id} k={k} roomId={project.share?.roomId} />
                  ))}
                </div>
              ) : null}

              <p className="muted small">{t("share.lead")}</p>

              <div className="share-modal__section">
                <label className="card__label">{t("share.linkSection")}</label>
                <div className="share-link-controls">
                  <Select
                    value={mode}
                    onChange={(v) => setMode(v as "approval" | "open")}
                    options={[
                      { value: "approval", label: t("share.mode.approval") },
                      { value: "open", label: t("share.mode.open") },
                    ]}
                  />
                  <Select
                    value={expDays}
                    onChange={setExpDays}
                    options={[
                      { value: "never", label: t("share.exp.never") },
                      { value: "1", label: t("share.exp.d1") },
                      { value: "7", label: t("share.exp.d7") },
                      { value: "30", label: t("share.exp.d30") },
                    ]}
                  />
                </div>
                <div className="share-link-actions">
                  <button className="action action--gen" onClick={() => void copyLink(false)}>
                    {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}{" "}
                    {copied ? t("share.copied") : t("share.copyLink")}
                  </button>
                  {project.share?.linkToken ? (
                    <button
                      className="action"
                      title={t("share.regenerate")}
                      onClick={() => void copyLink(true)}
                    >
                      <IconRefresh size={15} /> {t("share.regenerate")}
                    </button>
                  ) : null}
                  <IconLink size={15} className="muted" />
                </div>
              </div>

              <div className="share-modal__section">
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
