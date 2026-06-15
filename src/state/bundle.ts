/**
 * Portable project bundle: a .zip with `project.json` + an `assets/` folder
 * holding every generated image/video. Unlike the JSON-only export (which only
 * references local files on this machine), a bundle is self-contained — importing
 * it on another machine restores the media to that machine's local store.
 */

import JSZip from "jszip";
import type { Project } from "@/types/project";
import { config } from "@/config";

function extOf(url: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? `.${m[1]}` : "";
}
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

/** Export the whole project + its media as a self-contained .zip bundle. */
export async function exportBundle(project: Project) {
  const zip = new JSZip();
  const p = structuredClone(project);
  p.settings.anthropicApiKey = "";
  p.settings.magnificApiKey = "";
  const sceneNum = (id: string) => p.scenes.find((s) => s.id === id)?.number ?? "x";

  // Fetch an asset and store it in the bundle; return the relative ref to save.
  const grab = async (url: string, base: string): Promise<string> => {
    try {
      const r = await fetch(url);
      if (!r.ok) return url;
      const rel = `assets/${base}${extOf(url)}`;
      zip.file(rel, await r.blob());
      return rel;
    } catch {
      return url;
    }
  };

  for (const s of p.shots) {
    const tag = `e${sceneNum(s.sceneId)}-p${s.order}`;
    if (s.keyframeUrl) s.keyframeUrl = await grab(s.keyframeUrl, `${tag}-keyframe`);
    if (s.videoUrl) s.videoUrl = await grab(s.videoUrl, `${tag}-video`);
  }
  if (p.delivery.finalVideoUrl) {
    p.delivery.finalVideoUrl = await grab(p.delivery.finalVideoUrl, "video-final");
  }
  for (const tr of p.audio ?? []) {
    if (tr.url) tr.url = await grab(tr.url, `audio-${tr.id}`);
  }

  zip.file("project.json", JSON.stringify(p, null, 2));
  saveBlob(await zip.generateAsync({ type: "blob" }), `${slug(project.name) || "proyecto"}.studio.zip`);
}

/** Read a .zip bundle, restore its assets to this machine, return the project. */
export async function importBundle(file: File): Promise<Project> {
  const zip = await JSZip.loadAsync(file);
  const jsonFile = zip.file("project.json");
  if (!jsonFile) throw new Error("El .zip no contiene project.json");
  const project = JSON.parse(await jsonFile.async("string")) as Project;

  const restore = async (rel?: string): Promise<string | undefined> => {
    if (!rel || !rel.startsWith("assets/")) return rel;
    const f = zip.file(rel);
    if (!f) return rel;
    const base64 = await f.async("base64");
    const res = await fetch(`${config.directorBase}/upload`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rel, base64 }),
    });
    const data = (await res.json()) as { url?: string };
    return data.url ?? rel;
  };

  for (const s of project.shots) {
    s.keyframeUrl = await restore(s.keyframeUrl);
    s.videoUrl = await restore(s.videoUrl);
  }
  project.delivery.finalVideoUrl = await restore(project.delivery.finalVideoUrl);
  for (const tr of project.audio ?? []) {
    tr.url = await restore(tr.url);
  }
  return project;
}
