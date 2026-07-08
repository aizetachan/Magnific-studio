import { useEffect, useState } from "react";
import { authEnabled, watchAuth } from "@/auth/firebase";
import { shareEnabled } from "./db";
import { watchApprovedKnocks, watchMyPendingKnocks, type Knock } from "./links";
import { watchAcceptedInvites, type Invite } from "./invites";

/** Someone with access to one of my files (via link approval or invite). */
export interface Collaborator {
  key: string;
  email: string;
  name?: string;
  photo?: string;
  projectId: string;
  projectName: string;
}

/** Live list of MY pending join requests (all projects). Re-subscribes on
 * auth changes; empty in dev mode. */
export function useMyPendingKnocks(): Knock[] {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  useEffect(() => {
    if (!shareEnabled || !authEnabled) return;
    let un: (() => void) | null = null;
    const unAuth = watchAuth((u) => {
      un?.();
      un = null;
      if (u) un = watchMyPendingKnocks(setKnocks);
      else setKnocks([]);
    });
    return () => {
      un?.();
      unAuth();
    };
  }, []);
  return knocks;
}

/** Live list of everyone WITH ACCESS to any of my files. */
export function useMyCollaborators(): Collaborator[] {
  const [fromKnocks, setFromKnocks] = useState<Collaborator[]>([]);
  const [fromInvites, setFromInvites] = useState<Collaborator[]>([]);
  useEffect(() => {
    if (!shareEnabled || !authEnabled) return;
    let unK: (() => void) | null = null;
    let unI: (() => void) | null = null;
    const unAuth = watchAuth((u) => {
      unK?.();
      unI?.();
      unK = unI = null;
      if (!u) {
        setFromKnocks([]);
        setFromInvites([]);
        return;
      }
      unK = watchApprovedKnocks((ks: Knock[]) =>
        setFromKnocks(
          ks.map((k) => ({
            key: `k_${k.id}`,
            email: k.email,
            name: k.name,
            photo: k.photo,
            projectId: k.projectId,
            projectName: k.projectName,
          })),
        ),
      );
      unI = watchAcceptedInvites((is: Invite[]) =>
        setFromInvites(
          is.map((i) => ({
            key: `i_${i.id}`,
            email: i.toEmail,
            projectId: i.projectId,
            projectName: i.projectName,
          })),
        ),
      );
    });
    return () => {
      unK?.();
      unI?.();
      unAuth();
    };
  }, []);
  // Dedupe by email+project (someone may have both an invite and a knock).
  const seen = new Set<string>();
  return [...fromKnocks, ...fromInvites].filter((c) => {
    const k = `${c.email}|${c.projectId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
