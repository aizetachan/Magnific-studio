/**
 * Desktop-folder mirror. The linked folder reproduces the production tree
 * exactly as the app shows it:
 *
 *   <carpeta>/<Producción>/production.json          full manifest
 *   <carpeta>/<Producción>/SQ010/SC010/node.json     title, status, takes (EDL)
 *   <carpeta>/<Producción>/SQ010/SC010/media/SC010_vid_v001.mp4
 *   <carpeta>/<Producción>/SQ010/SC010/SH0010/node.json
 *
 * Takes are written as in/out metadata (non-destructive): the original media
 * stays in the folder of the node that generated it. Rendering the physical
 * cut files is a backend (ffmpeg) step.
 */

import {
  fsSafeName,
  initLocalDir,
  localDirName,
  localDirStatus,
  pickDirectory,
  readLocalFile,
  requestAccess,
  subscribeLocalDir,
  writeLocalFile,
  type LocalDirStatus,
} from "@/state/localdir";
import { useEffect, useState } from "react";
import { codeOf, mediaFileName, pathOf, STATUS_LABEL, type Media, type Production } from "./model";

export { pickDirectory, requestAccess };

export function useFolder(): { status: LocalDirStatus; name: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    void initLocalDir();
    return subscribeLocalDir(() => force((x) => x + 1));
  }, []);
  return { status: localDirStatus(), name: localDirName() };
}

const ready = () => localDirStatus() === "ready";
const rootOf = (p: Production) => fsSafeName(p.name);

function extFor(blob: Blob, m: Media): string {
  const t = blob.type;
  if (t.includes("svg")) return "svg";
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("webp")) return "webp";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  return m.kind === "video" ? "mp4" : "png";
}

/** Write one media file into its node's folder. Returns the relative path. */
export async function mirrorMedia(p: Production, m: Media): Promise<string | undefined> {
  if (!ready() || !m.url) return undefined;
  const node = p.nodes.find((n) => n.id === m.nodeId);
  if (!node) return undefined;
  try {
    const blob = await (await fetch(m.url)).blob();
    const path = `${rootOf(p)}/${pathOf(p, node)}/media/${mediaFileName(p, m, extFor(blob, m))}`;
    return (await writeLocalFile(path, blob)) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Metadata pass: manifest + one node.json per folder (cheap; run often). */
export async function mirrorMetadata(p: Production): Promise<boolean> {
  if (!ready()) return false;
  const root = rootOf(p);
  await writeLocalFile(`${root}/production.json`, JSON.stringify(p, null, 2));
  for (const n of p.nodes) {
    const takes = p.takes
      .filter((t) => t.nodeId === n.id)
      .map((t) => {
        const m = p.media.find((x) => x.id === t.mediaId);
        return {
          id: t.id,
          selected: n.selectedTakeId === t.id,
          source: m?.filePath ? m.filePath.slice(root.length + 1) : null,
          in: t.inSec,
          out: t.outSec,
          by: t.createdBy,
        };
      });
    const doc = {
      code: codeOf(p, n),
      level: p.levels[n.level]?.name,
      title: n.title,
      status: STATUS_LABEL[n.status],
      assignee: n.assignee ?? null,
      notes: n.notes,
      takes,
      comments: p.comments
        .filter((c) => c.nodeId === n.id)
        .map((c) => ({ author: c.author, text: c.text, at: c.atSec ?? null, date: new Date(c.createdAt).toISOString() })),
    };
    await writeLocalFile(`${root}/${pathOf(p, n)}/node.json`, JSON.stringify(doc, null, 2));
  }
  return true;
}

/** Full resync: every ready media not yet on disk, then metadata. */
export async function mirrorAll(p: Production): Promise<Record<string, string>> {
  const written: Record<string, string> = {};
  if (!ready()) return written;
  for (const m of p.media) {
    if (m.status !== "ready") continue;
    const path = await mirrorMedia(p, m);
    if (path) written[m.id] = path;
  }
  await mirrorMetadata({
    ...p,
    media: p.media.map((m) => (written[m.id] ? { ...m, filePath: written[m.id] } : m)),
  });
  return written;
}

/** blob: URLs die with the tab — reload them from the mirrored files. */
export async function rehydrate(p: Production): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  if (!ready()) return urls;
  for (const m of p.media) {
    if (!m.filePath || (m.url && !m.url.startsWith("blob:"))) continue;
    const f = await readLocalFile(m.filePath);
    if (f) urls[m.id] = URL.createObjectURL(f);
  }
  return urls;
}
