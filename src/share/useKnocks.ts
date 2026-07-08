import { useEffect, useState } from "react";
import { authEnabled, watchAuth } from "@/auth/firebase";
import { shareEnabled } from "./db";
import { watchMyPendingKnocks, type Knock } from "./links";

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
