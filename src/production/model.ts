/**
 * Magnific Production — domain model.
 *
 * Unlike Studio (a linear phase pipeline), a Production is a TREE of nodes
 * whose levels are configurable per production (default Secuencia > Escena >
 * Plano). Every node is a folder, both in the app and on disk, addressed by
 * its stable code path (SQ010/SC020/SH0030).
 *
 * Two concepts separate "what was generated" from "where it is used":
 *   - Media: a generated file (an image, a 30 s video) owned by the node where
 *     it was produced. Never modified.
 *   - Take: a NON-destructive cut of a media (in/out) placed in a node. A
 *     scene can produce one long clip and distribute its cuts to its shots, or
 *     keep the whole thing at scene level.
 *
 * Everything is flat, id-keyed and JSON-serializable so each collection maps
 * 1:1 to cloud documents (one doc per node / media / take / comment) when the
 * team sync lands.
 */

export type LevelRole = "group" | "production" | "unit";

export interface LevelDef {
  id: string;
  /** Display name, e.g. "Secuencia". */
  name: string;
  /** Code prefix, e.g. "SQ". */
  prefix: string;
  /** Numbering step (10 → 010, 020… leaves room to insert). */
  step: number;
  /** Zero-padding of the number. */
  pad: number;
  /** Whether media can be generated directly at this level. */
  canGenerate: boolean;
  /** Max video length generated at this level (seconds). */
  maxVideoSec: number;
}

export type NodeStatus = "todo" | "wip" | "review" | "approved";

export interface ProdNode {
  id: string;
  parentId: string | null;
  /** Index into Production.levels. */
  level: number;
  /** Stable number used in the code (10, 20, 25…). */
  number: number;
  title: string;
  notes: string;
  status: NodeStatus;
  assignee?: string;
  /** The take chosen as this node's current result. */
  selectedTakeId?: string;
}

export type MediaKind = "image" | "video";
export type MediaStatus = "queued" | "rendering" | "ready" | "failed";

export interface Media {
  id: string;
  /** Node where it was generated (its folder on disk). */
  nodeId: string;
  kind: MediaKind;
  /** Per node + kind version number (v001, v002…). */
  version: number;
  prompt: string;
  model: string;
  durationSec: number;
  status: MediaStatus;
  progress: number;
  url?: string;
  /** Path of the mirrored file inside the linked desktop folder. */
  filePath?: string;
  /** Magnific creation/task id — lets a video use this image as start frame. */
  taskId?: string;
  /** Media used as the start frame / reference. */
  sourceMediaId?: string;
  error?: string;
  credits?: number;
  createdBy: string;
  createdAt: number;
}

export interface Take {
  id: string;
  /** Node where the take is placed (may differ from the media's node). */
  nodeId: string;
  mediaId: string;
  inSec: number;
  outSec: number;
  createdBy: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  nodeId: string;
  mediaId?: string;
  /** Timecode within the media, when the comment points at a moment. */
  atSec?: number;
  author: string;
  text: string;
  createdAt: number;
}

export interface Production {
  id: string;
  name: string;
  createdAt: number;
  levels: LevelDef[];
  nodes: ProdNode[];
  media: Media[];
  takes: Take[];
  comments: Comment[];
}

// --- ids ---

let seq = 0;
export const newId = (p: string) =>
  `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// --- defaults ---

export function defaultLevels(): LevelDef[] {
  return [
    { id: newId("lv"), name: "Secuencia", prefix: "SQ", step: 10, pad: 3, canGenerate: false, maxVideoSec: 30 },
    { id: newId("lv"), name: "Escena", prefix: "SC", step: 10, pad: 3, canGenerate: true, maxVideoSec: 30 },
    { id: newId("lv"), name: "Plano", prefix: "SH", step: 10, pad: 4, canGenerate: true, maxVideoSec: 15 },
  ];
}

export function newProduction(name: string): Production {
  const p: Production = {
    id: newId("prod"),
    name,
    createdAt: Date.now(),
    levels: defaultLevels(),
    nodes: [],
    media: [],
    takes: [],
    comments: [],
  };
  const sq = addNode(p, null, "Apertura");
  const sc = addNode(p, sq.id, "Exterior · Amanecer");
  addNode(p, sc.id, "Plano general");
  addNode(p, sc.id, "Plano medio");
  return p;
}

// --- tree queries ---

export const isUnit = (p: Production, n: ProdNode) => n.level >= p.levels.length - 1;

export function roleOf(p: Production, n: ProdNode): LevelRole {
  if (isUnit(p, n)) return "unit";
  return p.levels[n.level]?.canGenerate ? "production" : "group";
}

export function childrenOf(p: Production, parentId: string | null): ProdNode[] {
  return p.nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.number - b.number);
}

export function ancestors(p: Production, n: ProdNode): ProdNode[] {
  const out: ProdNode[] = [];
  let cur: ProdNode | undefined = n;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? p.nodes.find((x) => x.id === cur!.parentId) : undefined;
  }
  return out;
}

export function descendants(p: Production, id: string): ProdNode[] {
  const out: ProdNode[] = [];
  const walk = (pid: string) => {
    for (const c of childrenOf(p, pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

// --- codes & paths ---

export function codeOf(p: Production, n: ProdNode): string {
  const lv = p.levels[n.level];
  if (!lv) return String(n.number);
  return `${lv.prefix}${String(n.number).padStart(lv.pad, "0")}`;
}

/** Folder path on disk: "SQ010/SC020/SH0030". */
export function pathOf(p: Production, n: ProdNode): string {
  return ancestors(p, n).map((a) => codeOf(p, a)).join("/");
}

/** Human scope label for prompts / filenames: "SQ010 · SC020 · SH0030". */
export function labelOf(p: Production, n: ProdNode): string {
  return ancestors(p, n).map((a) => codeOf(p, a)).join(" · ");
}

export const versionTag = (v: number) => `v${String(v).padStart(3, "0")}`;

export function mediaFileName(p: Production, m: Media, ext: string): string {
  const n = p.nodes.find((x) => x.id === m.nodeId);
  const code = n ? codeOf(p, n) : "media";
  return `${code}_${m.kind === "video" ? "vid" : "img"}_${versionTag(m.version)}.${ext}`;
}

// --- mutations (operate on a draft) ---

export function addNode(p: Production, parentId: string | null, title = ""): ProdNode {
  const parent = parentId ? p.nodes.find((n) => n.id === parentId) : undefined;
  const level = parent ? parent.level + 1 : 0;
  if (level >= p.levels.length) throw new Error("El plano es el último nivel");
  const step = p.levels[level].step;
  const siblings = childrenOf(p, parentId);
  const last = siblings[siblings.length - 1];
  const n: ProdNode = {
    id: newId("n"),
    parentId,
    level,
    number: last ? Math.floor(last.number / step) * step + step : step,
    title,
    notes: "",
    status: "todo",
  };
  p.nodes.push(n);
  return n;
}

/** Insert right after `afterId`, using the gap in numbering (010 → 015 → 020). */
export function insertAfter(p: Production, afterId: string, title = ""): ProdNode {
  const after = p.nodes.find((n) => n.id === afterId)!;
  const siblings = childrenOf(p, after.parentId);
  const i = siblings.findIndex((s) => s.id === afterId);
  const next = siblings[i + 1];
  if (!next) return addNode(p, after.parentId, title);
  const gap = next.number - after.number;
  if (gap < 2) {
    renumber(p, after.parentId);
    return insertAfter(p, afterId, title);
  }
  const n: ProdNode = {
    id: newId("n"),
    parentId: after.parentId,
    level: after.level,
    number: after.number + Math.floor(gap / 2),
    title,
    notes: "",
    status: "todo",
  };
  p.nodes.push(n);
  return n;
}

/** Re-apply the level step to a sibling list (010, 020, 030…). */
export function renumber(p: Production, parentId: string | null): void {
  childrenOf(p, parentId).forEach((n, i) => {
    n.number = (i + 1) * p.levels[n.level].step;
  });
}

export function moveNode(p: Production, id: string, dir: -1 | 1): void {
  const n = p.nodes.find((x) => x.id === id);
  if (!n) return;
  const siblings = childrenOf(p, n.parentId);
  const i = siblings.findIndex((s) => s.id === id);
  const other = siblings[i + dir];
  if (!other) return;
  [n.number, other.number] = [other.number, n.number];
}

export function removeNode(p: Production, id: string): void {
  const ids = new Set([id, ...descendants(p, id).map((d) => d.id)]);
  p.nodes = p.nodes.filter((n) => !ids.has(n.id));
  const mediaIds = new Set(p.media.filter((m) => ids.has(m.nodeId)).map((m) => m.id));
  p.media = p.media.filter((m) => !mediaIds.has(m.id));
  p.takes = p.takes.filter((t) => !ids.has(t.nodeId) && !mediaIds.has(t.mediaId));
  p.comments = p.comments.filter((c) => !ids.has(c.nodeId));
}

/** Add a level at the TOP (e.g. Episodio above Secuencia): existing nodes shift down. */
export function addLevelOnTop(p: Production, def: Omit<LevelDef, "id">): void {
  p.levels.unshift({ ...def, id: newId("lv") });
  p.nodes.forEach((n) => (n.level += 1));
  const roots = p.nodes.filter((n) => n.parentId === null);
  if (roots.length) {
    const top: ProdNode = {
      id: newId("n"),
      parentId: null,
      level: 0,
      number: def.step,
      title: "",
      notes: "",
      status: "todo",
    };
    p.nodes.push(top);
    roots.forEach((r) => (r.parentId = top.id));
  }
}

/** Remove the TOP level (only when it has at most one node, to never lose structure). */
export function removeTopLevel(p: Production): boolean {
  if (p.levels.length <= 1) return false;
  const roots = p.nodes.filter((n) => n.parentId === null);
  if (roots.length > 1) return false;
  const root = roots[0];
  if (root) {
    childrenOf(p, root.id).forEach((c) => (c.parentId = null));
    p.nodes = p.nodes.filter((n) => n.id !== root.id);
    p.media = p.media.filter((m) => m.nodeId !== root.id);
    p.takes = p.takes.filter((t) => t.nodeId !== root.id);
    p.comments = p.comments.filter((c) => c.nodeId !== root.id);
  }
  p.levels.shift();
  p.nodes.forEach((n) => (n.level -= 1));
  return true;
}

export function nextVersion(p: Production, nodeId: string, kind: MediaKind): number {
  const vs = p.media.filter((m) => m.nodeId === nodeId && m.kind === kind).map((m) => m.version);
  return vs.length ? Math.max(...vs) + 1 : 1;
}

// --- cutting ---

export interface Segment {
  inSec: number;
  outSec: number;
}

/** Turn cut points into contiguous segments covering [0, duration]. */
export function segmentsFromCuts(durationSec: number, cuts: number[]): Segment[] {
  const pts = [...new Set(cuts.map((c) => round(c)))]
    .filter((c) => c > 0 && c < durationSec)
    .sort((a, b) => a - b);
  const edges = [0, ...pts, round(durationSec)];
  const out: Segment[] = [];
  for (let i = 0; i < edges.length - 1; i++) out.push({ inSec: edges[i], outSec: edges[i + 1] });
  return out;
}

export const round = (s: number) => Math.round(s * 10) / 10;

export function addTake(
  p: Production,
  args: { nodeId: string; mediaId: string; inSec: number; outSec: number; by: string; select?: boolean },
): Take {
  const t: Take = {
    id: newId("tk"),
    nodeId: args.nodeId,
    mediaId: args.mediaId,
    inSec: round(args.inSec),
    outSec: round(args.outSec),
    createdBy: args.by,
    createdAt: Date.now(),
  };
  p.takes.push(t);
  const n = p.nodes.find((x) => x.id === args.nodeId);
  if (n && (args.select || !n.selectedTakeId)) n.selectedTakeId = t.id;
  if (n && n.status === "todo") n.status = "wip";
  return t;
}

export const takeDuration = (t: Take) => round(t.outSec - t.inSec);

/** Total selected duration of a node: its own take, else the sum of its children. */
export function nodeDuration(p: Production, n: ProdNode): number {
  const own = n.selectedTakeId ? p.takes.find((t) => t.id === n.selectedTakeId) : undefined;
  if (own) return takeDuration(own);
  return round(childrenOf(p, n.id).reduce((s, c) => s + nodeDuration(p, c), 0));
}

export function progressOf(p: Production, n: ProdNode): { approved: number; total: number } {
  const units = isUnit(p, n) ? [n] : descendants(p, n.id).filter((d) => isUnit(p, d));
  return { approved: units.filter((u) => u.status === "approved").length, total: units.length };
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  todo: "Pendiente",
  wip: "En curso",
  review: "En revisión",
  approved: "Aprobado",
};
