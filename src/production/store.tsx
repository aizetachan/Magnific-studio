/**
 * Production store — one Production in memory, persisted to localStorage and
 * mirrored to the linked desktop folder. `update(draft => …)` mirrors Studio's
 * ProjectStore idiom: mutate a structured clone, commit atomically.
 *
 * Team sync (cloud source of truth) will replace localStorage behind this same
 * API; the model is already one-doc-per-entity friendly.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { newProduction, type Production } from "./model";

const KEY = "magnific-production:v1";
const USER_KEY = "magnific-production:user";

function load(): Production {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Production;
  } catch {
    /* fresh */
  }
  return newProduction("Nueva producción");
}

interface StoreValue {
  prod: Production;
  /** Latest state, for async callbacks that outlive a render. */
  get: () => Production;
  update: (fn: (d: Production) => void) => void;
  replace: (p: Production) => void;
  user: string;
  setUser: (u: string) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function ProductionProvider({ children }: { children: ReactNode }) {
  const [prod, setProd] = useState<Production>(load);
  const ref = useRef(prod);
  const [user, setUserState] = useState(() => localStorage.getItem(USER_KEY) ?? "");
  const [selectedId, select] = useState<string | null>(null);

  const update = useCallback((fn: (d: Production) => void) => {
    const draft = structuredClone(ref.current);
    fn(draft);
    ref.current = draft;
    setProd(draft);
  }, []);

  const replace = useCallback((p: Production) => {
    ref.current = p;
    setProd(p);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(prod));
      } catch {
        /* quota: the folder mirror still holds the files */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [prod]);

  const setUser = useCallback((u: string) => {
    localStorage.setItem(USER_KEY, u);
    setUserState(u);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ prod, get: () => ref.current, update, replace, user, setUser, selectedId, select }),
    [prod, update, replace, user, setUser, selectedId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProduction(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProduction outside ProductionProvider");
  return v;
}

export type ProductionStore = StoreValue;
