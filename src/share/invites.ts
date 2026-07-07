/**
 * Share invitations (Firestore — durable metadata only, never content).
 * A invita a B por email; B las ve al entrar con su Google y acepta.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore, me } from "./db";

export interface Invite {
  id: string;
  projectId: string;
  projectName: string;
  roomId: string;
  fromUid: string;
  fromEmail: string;
  toEmail: string;
  accepted?: boolean;
}

const invitesCol = () => collection(firestore(), "invites");

export async function sendInvite(input: {
  projectId: string;
  projectName: string;
  roomId: string;
  toEmail: string;
}): Promise<void> {
  const user = me();
  if (!user) throw new Error("Inicia sesión para compartir");
  await addDoc(invitesCol(), {
    ...input,
    toEmail: input.toEmail.trim().toLowerCase(),
    fromUid: user.uid,
    fromEmail: user.email,
    accepted: false,
    at: Date.now(),
  });
}

/** Pending invitations addressed to the signed-in user. */
export async function myInvites(): Promise<Invite[]> {
  const user = me();
  if (!user?.email) return [];
  const q = query(
    invitesCol(),
    where("toEmail", "==", user.email.toLowerCase()),
    where("accepted", "==", false),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invite, "id">) }));
}

export async function acceptInvite(id: string): Promise<void> {
  await updateDoc(doc(firestore(), "invites", id), { accepted: true });
}

export async function declineInvite(id: string): Promise<void> {
  await deleteDoc(doc(firestore(), "invites", id));
}
