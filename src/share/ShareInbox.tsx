import { useEffect, useState } from "react";
import { IconUsersGroup } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { createBlankProject } from "@/state/seed";
import { saveProject } from "@/state/persistence";
import { me, shareEnabled } from "./db";
import { acceptInvite, declineInvite, myInvites, type Invite } from "./invites";

/**
 * Pending share invitations — the "notification" the invitee sees on entry.
 * Accepting creates a local stub bound to the room; the sync engine then
 * pulls the snapshot and every asset lands in THIS user's local folder.
 */
export function ShareInbox() {
  const { switchProject } = useStore();
  const [invites, setInvites] = useState<Invite[]>([]);
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
  };

  return (
    <div className="conn-banner" role="status">
      <IconUsersGroup size={16} />
      <span>
        <b>{invites[0].fromEmail}</b> ha compartido contigo{" "}
        <b>«{invites[0].projectName}»</b>. Al aceptar, lo que se genere se
        guardará también en tu máquina.
      </span>
      <button className="conn-banner__cta" onClick={() => void accept(invites[0])}>
        Aceptar y abrir
      </button>
      <button
        className="conn-banner__cta"
        onClick={() => {
          void declineInvite(invites[0].id).catch(() => {});
          setInvites((xs) => xs.slice(1));
        }}
      >
        Rechazar
      </button>
    </div>
  );
}
