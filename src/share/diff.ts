/**
 * Entity-level diff/apply for realtime sync.
 *
 * The project is one JSON doc; concurrent editing happens at the granularity
 * of scenes/shots/tracks/library assets (arrays of {id}) and a few singular
 * sections. Two users editing DIFFERENT entities merge cleanly; the same
 * entity is last-writer-wins (field locks minimize that case).
 */

import type { Project } from "@/types/project";

/** Sections synced as id-keyed collections. */
const COLLECTIONS = ["scenes", "shots", "audio", "library"] as const;
/** Sections synced as whole values (small or singular). settings (credentials)
 * and consumption (each user's own meter) are deliberately NOT synced. */
const SINGLETONS = ["name", "story", "delivery", "edit", "gates", "styleId"] as const;

export interface SyncOp {
  /** Collection element: {section, id, value|null(=delete)}; singleton: {section, value}. */
  section: string;
  id?: string;
  value: unknown | null;
}

type AnyRec = Record<string, unknown>;
const js = (v: unknown) => JSON.stringify(v ?? null);

/** Ops that turn `prev` into `next`. Empty array = no observable change. */
export function computeOps(prev: Project, next: Project): SyncOp[] {
  const ops: SyncOp[] = [];
  const p = prev as unknown as AnyRec;
  const n = next as unknown as AnyRec;

  for (const section of COLLECTIONS) {
    const before = new Map(
      ((p[section] as AnyRec[] | undefined) ?? []).map((e) => [String(e.id), e]),
    );
    const after = ((n[section] as AnyRec[] | undefined) ?? []).map((e) => e);
    const seen = new Set<string>();
    for (const e of after) {
      const id = String(e.id);
      seen.add(id);
      const old = before.get(id);
      if (!old || js(old) !== js(e)) ops.push({ section, id, value: e });
    }
    for (const id of before.keys()) {
      if (!seen.has(id)) ops.push({ section, id, value: null });
    }
  }
  for (const section of SINGLETONS) {
    if (js(p[section]) !== js(n[section])) ops.push({ section, value: n[section] ?? null });
  }
  return ops;
}

/** Ensure required containers exist after any inbound merge (a hostile or
 * legacy peer payload must never crash the UI). Mutates and returns p. */
export function normalizeProject(p: Project): Project {
  const d = p as unknown as AnyRec;
  d.scenes = Array.isArray(d.scenes) ? d.scenes : [];
  d.shots = Array.isArray(d.shots) ? d.shots : [];
  d.library = Array.isArray(d.library) ? d.library : [];
  if (!d.story || typeof d.story !== "object") d.story = { logline: "", characters: [], arcs: [], tone: "" };
  const st = d.story as AnyRec;
  st.characters = Array.isArray(st.characters) ? st.characters : [];
  st.arcs = Array.isArray(st.arcs) ? st.arcs : [];
  if (!d.delivery || typeof d.delivery !== "object") d.delivery = {};
  if (!d.gates || typeof d.gates !== "object") d.gates = { story: "in_progress", script: "locked", storyboard: "locked", production: {}, delivery: "locked" };
  if (!d.consumption || typeof d.consumption !== "object") d.consumption = { events: [] };
  const co = d.consumption as AnyRec;
  co.events = Array.isArray(co.events) ? co.events : [];
  for (const sc of d.scenes as AnyRec[]) {
    if (sc.characterIds != null && !Array.isArray(sc.characterIds)) sc.characterIds = [];
  }
  for (const sh of d.shots as AnyRec[]) {
    if (sh.characterIds != null && !Array.isArray(sh.characterIds)) sh.characterIds = [];
    if (sh.keyframeHistory != null && !Array.isArray(sh.keyframeHistory)) sh.keyframeHistory = [];
    if (sh.videoHistory != null && !Array.isArray(sh.videoHistory)) sh.videoHistory = [];
  }
  return p;
}

/** Apply remote ops onto a draft project (mutates). Preserves array order for
 * updates; new entities append (order refinements arrive as sibling updates). */
export function applyOps(draft: Project, ops: SyncOp[]): void {
  const d = draft as unknown as AnyRec;
  for (const op of ops) {
    if (op.id != null && (COLLECTIONS as readonly string[]).includes(op.section)) {
      const arr = ((d[op.section] as AnyRec[] | undefined) ?? []) as AnyRec[];
      const at = arr.findIndex((e) => String(e.id) === op.id);
      if (op.value === null) {
        if (at >= 0) arr.splice(at, 1);
      } else if (at >= 0) {
        arr[at] = op.value as AnyRec;
      } else {
        arr.push(op.value as AnyRec);
      }
      d[op.section] = arr;
    } else if ((SINGLETONS as readonly string[]).includes(op.section)) {
      d[op.section] = op.value ?? undefined;
    }
  }
}
