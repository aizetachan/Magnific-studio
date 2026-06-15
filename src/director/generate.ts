/**
 * Claude-driven generation of the story and the script.
 *
 * Claude is the brain: it PROPOSES a story (logline/characters/arcs) and a
 * script (N scenes, each with recommended shots). The user then edits and
 * decides (add/remove scenes & shots) in the pages. We ask for strict JSON and
 * parse it tolerantly. Requires the user's Anthropic key (Ajustes).
 */

import type { StoreValue } from "@/state/ProjectStore";
import type { PageContext } from "@/types/pipeline";
import type { Scene, Shot } from "@/types/project";
import { newShot, uid } from "@/state/seed";
import { askClaude } from "./ask";

/** Tolerant JSON extraction: strips ``` fences and surrounding prose. */
function parseJson<T>(text: string): T {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t) as T;
}

const genCtx = (phase: PageContext["phase"]): PageContext => ({
  phase,
  phaseLabel: "Generación",
  visibleObjects: {},
  allowedActions: [],
  blockedActions: [],
  implicitReferent: "la historia",
});

const NEED_KEY = "Conecta tu API de Claude en Ajustes para generar.";

interface StoryJson {
  logline?: string;
  tone?: string;
  characters?: Array<{ name?: string; description?: string }>;
  arcs?: Array<{ title?: string; description?: string }>;
}

/** Develop/expand the story from the current idea (the logline field). */
export async function generateStory(api: StoreValue): Promise<void> {
  const idea = api.project.story.logline.trim();
  const prompt = [
    "Eres guionista profesional. Desarrolla la historia de un cortometraje.",
    idea
      ? `Idea de partida: ${idea}`
      : "No hay idea de partida: inventa una breve, original y rodable.",
    "Devuelve SOLO un JSON con esta forma exacta (sin texto extra):",
    '{"logline":"una frase","tone":"género/tono/referencias","characters":[{"name":"","description":""}],"arcs":[{"title":"","description":""}]}',
    "Máximo 5 personajes y 4 arcos. En español.",
  ].join("\n");

  const text = await askClaude(api, genCtx("story"), [{ role: "user", content: prompt }], () => "");
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<StoryJson>(text);

  api.update((d) => {
    if (data.logline) d.story.logline = String(data.logline);
    if (data.tone) d.story.tone = String(data.tone);
    if (Array.isArray(data.characters)) {
      d.story.characters = data.characters.map((c) => ({
        id: uid("char"),
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
      }));
    }
    if (Array.isArray(data.arcs)) {
      d.story.arcs = data.arcs.map((a) => ({
        id: uid("arc"),
        title: String(a.title ?? ""),
        description: String(a.description ?? ""),
      }));
    }
    if (d.gates.story === "in_progress" || d.gates.story === "locked") {
      d.gates.story = "ready";
    }
  });
}

/** Regenerate a SINGLE field of the story (logline/tone/characters/arcs). */
export async function generateStoryField(
  api: StoreValue,
  field: "logline" | "tone" | "characters" | "arcs",
): Promise<void> {
  const { story } = api.project;
  const ctxLines = [
    `Logline: ${story.logline || "(vacío)"}`,
    `Tono: ${story.tone || "(vacío)"}`,
    `Personajes: ${story.characters.map((c) => `${c.name}: ${c.description}`).join(" | ") || "(vacío)"}`,
    `Arcos: ${story.arcs.map((a) => `${a.title}: ${a.description}`).join(" | ") || "(vacío)"}`,
  ].join("\n");
  const shape =
    field === "logline"
      ? '{"logline":"una frase"}'
      : field === "tone"
        ? '{"tone":"género/tono/referencias"}'
        : field === "characters"
          ? '{"characters":[{"name":"","description":""}]}'
          : '{"arcs":[{"title":"","description":""}]}';
  const prompt = [
    "Eres guionista. Regenera SOLO este campo de la historia, coherente con el resto.",
    `Campo a regenerar: ${field}`,
    "Historia actual:",
    ctxLines,
    `Devuelve SOLO un JSON con esta forma: ${shape}`,
    "En español.",
  ].join("\n");

  const text = await askClaude(api, genCtx("story"), [{ role: "user", content: prompt }], () => "");
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<StoryJson>(text);

  api.update((d) => {
    if (field === "logline" && data.logline) d.story.logline = String(data.logline);
    if (field === "tone" && data.tone) d.story.tone = String(data.tone);
    if (field === "characters" && Array.isArray(data.characters)) {
      d.story.characters = data.characters.map((c) => ({
        id: uid("char"),
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
      }));
    }
    if (field === "arcs" && Array.isArray(data.arcs)) {
      d.story.arcs = data.arcs.map((a) => ({
        id: uid("arc"),
        title: String(a.title ?? ""),
        description: String(a.description ?? ""),
      }));
    }
  });
}

interface ScriptJson {
  scenes?: Array<{
    heading?: string;
    action?: string;
    dialogue?: string;
    durationSec?: number;
    shots?: Array<{
      description?: string;
      keyframePrompt?: string;
      videoPrompt?: string;
      durationSec?: number;
    }>;
  }>;
}

/**
 * Generate the script: N scenes, each with recommended shots. Replaces the
 * project's scenes/shots and resets downstream phases (the structure changed).
 */
export async function generateScript(api: StoreValue): Promise<void> {
  const { story } = api.project;
  const prompt = [
    "Eres guionista profesional. Escribe el guion de un cortometraje dividido en escenas.",
    "Recomienda tú el número de escenas y, por cada escena, sus planos (shots) según la acción.",
    "Historia:",
    `- Logline: ${story.logline || "(genera una historia coherente)"}`,
    `- Tono: ${story.tone || "libre"}`,
    `- Personajes: ${story.characters.map((c) => `${c.name}: ${c.description}`).join(" | ") || "inventa los necesarios"}`,
    `- Arcos: ${story.arcs.map((a) => `${a.title}: ${a.description}`).join(" | ") || "—"}`,
    "Devuelve SOLO un JSON (sin texto extra):",
    '{"scenes":[{"heading":"INT. LUGAR — DÍA","action":"descripción de la acción","dialogue":"PERSONAJE: línea","durationSec":12,"shots":[{"description":"plano detalle de…","keyframePrompt":"cinematic English prompt for the still image","videoPrompt":"English prompt describing the motion","durationSec":5}]}]}',
    "Cada escena con 1-3 planos según la acción. heading, action y dialogue en español; keyframePrompt y videoPrompt en INGLÉS y cinematográficos.",
  ].join("\n");

  const text = await askClaude(
    api,
    genCtx("script"),
    [{ role: "user", content: prompt }],
    () => "",
    8192,
  );
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<ScriptJson>(text);
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("Claude no devolvió escenas. Inténtalo de nuevo.");
  }

  api.update((d) => {
    const scenes: Scene[] = [];
    const shots: Shot[] = [];
    data.scenes!.forEach((sc, i) => {
      const sceneId = uid("scene");
      scenes.push({
        id: sceneId,
        number: i + 1,
        heading: String(sc.heading ?? `Escena ${i + 1}`),
        action: String(sc.action ?? ""),
        dialogue: String(sc.dialogue ?? ""),
        durationSec: Number(sc.durationSec) || 10,
      });
      const list =
        Array.isArray(sc.shots) && sc.shots.length
          ? sc.shots
          : [{ description: sc.action, keyframePrompt: sc.action, videoPrompt: sc.action }];
      list.forEach((sh, j) => {
        shots.push(
          newShot(sceneId, j + 1, {
            description: sh.description ?? "",
            keyframePrompt: sh.keyframePrompt ?? sh.description ?? "",
            videoPrompt: sh.videoPrompt ?? sh.description ?? "",
            durationSec: Number(sh.durationSec) || 5,
          }),
        );
      });
    });

    d.scenes = scenes;
    d.shots = shots;
    // The structure changed → reset downstream phases.
    d.gates.script = "ready";
    d.gates.storyboard = "locked";
    d.gates.production = {};
    d.gates.delivery = "locked";
    d.delivery = {};
  });
}

/** Append N more scenes that continue the current script (does not reset). */
export async function generateMoreScenes(api: StoreValue, n: number): Promise<void> {
  const { story, scenes: existing } = api.project;
  const prompt = [
    `Eres guionista. Añade ${n} escena(s) NUEVA(S) que continúen el guion existente, sin repetir.`,
    "Historia:",
    `- Logline: ${story.logline}`,
    `- Tono: ${story.tone}`,
    "Escenas existentes (no las repitas):",
    existing.map((s) => `${s.number}. ${s.heading} — ${s.action}`).join("\n") || "(ninguna)",
    "Devuelve SOLO un JSON con exactamente las escenas nuevas:",
    '{"scenes":[{"heading":"INT. LUGAR — DÍA","action":"…","dialogue":"PERSONAJE: …","durationSec":12,"shots":[{"description":"…","keyframePrompt":"cinematic English prompt","videoPrompt":"English motion prompt","durationSec":5}]}]}',
    "heading/action/dialogue en español; keyframePrompt/videoPrompt en INGLÉS.",
  ].join("\n");

  const text = await askClaude(api, genCtx("script"), [{ role: "user", content: prompt }], () => "", 4096);
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<ScriptJson>(text);
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("Claude no devolvió escenas nuevas.");
  }

  api.update((d) => {
    let num = d.scenes.length;
    for (const sc of data.scenes!) {
      num += 1;
      const sceneId = uid("scene");
      d.scenes.push({
        id: sceneId,
        number: num,
        heading: String(sc.heading ?? `Escena ${num}`),
        action: String(sc.action ?? ""),
        dialogue: String(sc.dialogue ?? ""),
        durationSec: Number(sc.durationSec) || 10,
      });
      const list =
        Array.isArray(sc.shots) && sc.shots.length
          ? sc.shots
          : [{ description: sc.action }];
      list.forEach((sh, j) => {
        d.shots.push(
          newShot(sceneId, j + 1, {
            description: sh.description ?? "",
            keyframePrompt: sh.keyframePrompt ?? sh.description ?? "",
            videoPrompt: sh.videoPrompt ?? sh.description ?? "",
            durationSec: Number(sh.durationSec) || 5,
          }),
        );
      });
    }
  });
}
