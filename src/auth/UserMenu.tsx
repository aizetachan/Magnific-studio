import { useEffect, useRef, useState } from "react";
import { IconLogout } from "@tabler/icons-react";
import type { User } from "firebase/auth";
import { authEnabled, logout, watchAuth } from "./firebase";
import { useI18n } from "@/i18n";

/**
 * Signed-in user chip for the bottom of the dashboard sidebar: Google avatar
 * (or initial) + truncated name; clicking opens a small menu whose only
 * option (for now) is Log out. Hidden in dev mode (no Firebase auth).
 */
export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

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
        {user.photoURL ? (
          <img className="usermenu__avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="usermenu__avatar usermenu__avatar--initial">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="usermenu__name">{name}</span>
      </button>
    </div>
  );
}
