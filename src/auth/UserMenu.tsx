import { useEffect, useRef, useState } from "react";
import { IconLogout, IconUsersGroup, IconX } from "@tabler/icons-react";
import type { User } from "firebase/auth";
import { authEnabled, logout, watchAuth } from "./firebase";
import { useMyCollaborators, useMyPendingKnocks } from "@/share/useKnocks";
import { KnockRow } from "@/share/ShareControls";
import { loadProject } from "@/state/persistence";
import { useI18n } from "@/i18n";

/**
 * Signed-in user chip for the bottom of the dashboard sidebar: Google avatar
 * (or initial) + truncated name. A red badge signals pending join requests
 * from ANY of your files; the menu offers Collaborators (approve/reject from
 * the dashboard) and Log out.
 */
export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [showCollab, setShowCollab] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const knocks = useMyPendingKnocks();
  const collaborators = useMyCollaborators();

  useEffect(() => {
    if (!authEnabled) return;
    return watchAuth(setUser);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!authEnabled || !user) return null;
  const name = user.displayName || user.email || "—";

  return (
    <div className="usermenu" ref={rootRef}>
      {open ? (
        <div className="usermenu__pop" role="menu">
          <button
            className="usermenu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setShowCollab(true);
            }}
          >
            <IconUsersGroup size={15} /> {t("user.collaborators")}
            {knocks.length > 0 ? <span className="badge-dot badge-dot--inline">{knocks.length}</span> : null}
          </button>
          <button
            className="usermenu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <IconLogout size={15} /> {t("user.logout")}
          </button>
        </div>
      ) : null}
      <button
        className="usermenu__chip"
        onClick={() => setOpen((v) => !v)}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="usermenu__avatarwrap">
          {user.photoURL ? (
            <img className="usermenu__avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="usermenu__avatar usermenu__avatar--initial">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {knocks.length > 0 ? <span className="badge-dot">{knocks.length}</span> : null}
        </span>
        <span className="usermenu__name">{name}</span>
      </button>

      {showCollab ? (
        <div className="detail-modal" role="dialog" aria-modal="true" onClick={() => setShowCollab(false)}>
          <div className="detail-modal__panel confirm-modal share-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-modal__title">
              <IconUsersGroup size={18} style={{ verticalAlign: "-3px" }} /> {t("user.collaborators")}
            </h3>
            <div className="confirm-modal__msg">
              {knocks.length > 0 ? (
                <div className="share-modal__section">
                  <label className="card__label">{t("share.pending")}</label>
                  {knocks.map((k) => (
                    <KnockRow
                      key={k.id}
                      k={k}
                      roomId={loadProject(k.projectId)?.share?.roomId}
                      showProject
                    />
                  ))}
                </div>
              ) : null}
              {collaborators.length > 0 ? (
                <div className="share-modal__section">
                  <label className="card__label">{t("collab.access")}</label>
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
                          {c.email} · {t("collab.accessTo")} <b>«{c.projectName}»</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {knocks.length === 0 && collaborators.length === 0 ? (
                <p className="muted">{t("collab.empty")}</p>
              ) : null}
            </div>
            <div className="confirm-modal__actions">
              <button className="action" onClick={() => setShowCollab(false)}>
                <IconX size={14} /> {t("share.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
