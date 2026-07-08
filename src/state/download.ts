/**
 * Download helpers for generated assets — individually or all-in-one ZIP.
 * Assets are served locally by the Director (/api/director/files/...), so these
 * fetch the bytes and save them with meaningful, scene/plano-based names.
 */

import JSZip from "jszip";
import type { Project } from "@/types/project";

function extOf(url: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? `.${m[1]}` : "";
}

function saveBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

/** Download a single asset with a friendly base name (extension auto-added). */
export async function downloadAsset(url: string, baseName: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  saveBlob(await res.blob(), `${baseName}${extOf(url)}`);
}

/** Download plain text (e.g. the screenplay) as a .txt file. */
export function downloadText(filename: string, text: string) {
  saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Bundle every generated asset (keyframes, videos, final video) into one ZIP. */
export async function downloadAllZip(project: Project): Promise<number> {
  const zip = new JSZip();
  const sceneNum = (sceneId: string) =>
    project.scenes.find((s) => s.id === sceneId)?.number ?? "x";
  let count = 0;
  const add = async (url: string, path: string) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      zip.file(path + extOf(url), await r.blob());
      count++;
    } catch {
      /* skip an asset that can't be fetched */
    }
  };

  for (const shot of project.shots) {
    const base = `escena-${sceneNum(shot.sceneId)}-plano-${shot.order}`;
    if (shot.keyframeUrl) await add(shot.keyframeUrl, `storyboard/${base}-keyframe`);
    if (shot.videoUrl) await add(shot.videoUrl, `produccion/${base}-video`);
  }
  if (project.delivery.finalVideoUrl) {
    await add(project.delivery.finalVideoUrl, "entrega/video-final");
  }
  for (const tr of project.audio ?? []) {
    if (tr.url) await add(tr.url, `audio/${slug(tr.label) || tr.id}`);
  }

  if (count === 0) return 0;
  const out = await zip.generateAsync({ type: "blob" });
  saveBlob(out, `${slug(project.name) || "proyecto"}-assets.zip`);
  // Counts as "took a copy" for the unsaved-changes guard (fallback mode).
  window.dispatchEvent(new Event("ms:exported"));
  return count;
}
