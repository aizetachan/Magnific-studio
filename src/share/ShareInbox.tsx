import { useEffect, useState } from "react";
import { IconUsersGroup } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { createBlankProject } from "@/state/seed";
import { saveProject } from "@/state/persistence";
import { me, shareEnabled } from "./db";
import { acceptInvite, declineInvite, myInvites, type Invite } from "./invites";
import { useI18n } from "@/i18n";

/**
 * Pending share invitations — the "notification" the invitee sees on entry.
 * Accepting creates a local stub bound to the room; the sync engine then
 * pulls the snapshot and every asset lands in THIS user's local folder.
 */
export function ShareInbox() {
  const { switchProject } = useStore();
  const [invites, setInvites] = useState<Invite[]>([]);
  const { t } = useI18n();
  useEffect(() => {
    if (!shareEnabled || !me()) return;
    void myInvites().then(setInvites).catch(() => {});
  }, []);
  if (invites.length === 0) return null;

  const accept = async (inv: Invite) => {
    await acceptInvite(inv.id).catch(() => {});
    const stub = createBlankProject(inv.projectName);
    stub.id = inv.projectId;
    stub.share = { roomId: inv.roomId, ownerUid: inv.fromUid };
    saveProject(stub);
    setInvites((xs) => xs.filter((x) => x.id !== inv.id));
    switchProject(inv.projectId);
    window.dispatchEvent(new Event("ms:enter-studio"));
  };

  return (
    <div className="conn-banner" role="status">
      <IconUsersGroup size={16} />
      <span>
        <b>{invites[0].fromEmail}</b> {t("share.inboxFrom")}{" "}
        <b>«{invites[0].projectName}»</b> {t("share.inboxNote")}
      </span>
      <button className="conn-banner__cta" onClick={() => void accept(invites[0])}>
        {t("share.accept")}
      </button>
      <button
        className="conn-banner__cta"
        onClick={() => {
          void declineInvite(invites[0].id).catch(() => {});
          setInvites((xs) => xs.slice(1));
        }}
      >
        {t("share.decline")}
      </button>
    </div>
  );
}
