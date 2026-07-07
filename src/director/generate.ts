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
  style?: string;
  characters?: Array<{ name?: string; description?: string }>;
  environments?: Array<{ name?: string; description?: string }>;
  arcs?: Array<{ title?: string; description?: string }>;
}

/** Image prompt for a character reference (visual style is appended at gen time). */
export const characterPrompt = (name: string, description: string) =>
  `Character reference of ${name}. ${description}. Full-body, neutral background, consistent design.`;
/** Image prompt for an environment/location establishing shot (no characters). */
export const environmentPrompt = (name: string, description: string) =>
  `Establishing shot of ${name}. ${description}. Empty location, no people, wide angle.`;
/** Character model sheet: multiple views + expressions in one reference image. */
export const characterSheetPrompt = (name: string, description: string) =>
  `Character model sheet of ${name}: front, side and back full-body views plus 2-3 facial expressions, consistent character design, clean neutral background, professional turnaround reference sheet layout. ${description}`;
/** Environment 3×3 grid: nine camera viewpoints of the same location, no people. */
export const environmentGridPrompt = (name: string, description: string) =>
  `A 3x3 grid of nine different camera viewpoints of the same location "${name}": wide establishing, medium, close detail, high angle, low angle and varied framing; consistent place, no people, neat grid layout. ${description}`;

/**
 * Develop/expand the story from the current idea (the logline field). Also
 * proposes a GLOBAL VISUAL STYLE and the key ENVIRONMENTS, and creates the
 * matching Library assets (characters/locations/style) so previews can be
 * generated with a consistent look. Image generation happens separately
 * (generateAssetPreviews), after the style is set.
 */
export async function generateStory(api: StoreValue): Promise<void> {
  const idea = api.project.story.logline.trim();
  const nonce = Math.random().toString(36).slice(2, 8); // nudge variety between runs
  const prompt = [
    "Eres guionista y director de arte. Desarrolla la historia de un cortometraje.",
    idea
      ? `Notas / idea de partida del usuario (úsalas como base y conviértelas en un logline pulido): ${idea}`
      : "No hay idea de partida: inventa una breve, original y rodable.",
    `Da una propuesta FRESCA y diferente a versiones anteriores (no repitas). Semilla de variación: ${nonce}`,
    "Define también un ESTILO VISUAL global (técnica, paleta, iluminación, referencias) que se",
    "aplicará a TODAS las imágenes para mantener consistencia, y los ENTORNOS clave.",
    "IMPORTANTE: para CADA personaje y CADA entorno escribe SIEMPRE una 'description' concreta y visual (1-2 frases). En personajes: aspecto físico, vestuario y rasgo de carácter. En entornos: el lugar, el ambiente y la iluminación. Esta descripción se usa como contexto para generar su imagen, así que debe ser específica y nunca quedar vacía.",
    "Devuelve SOLO un JSON con esta forma exacta (sin texto extra):",
    '{"logline":"una frase","tone":"género/tono/referencias","style":"definición del estilo visual","characters":[{"name":"","description":""}],"environments":[{"name":"","description":""}],"arcs":[{"title":"","description":""}]}',
    "Máximo 5 personajes, 5 entornos y 4 arcos. Textos en español; el style describe el look visual.",
  ].join("\n");

  const text = await askClaude(api, genCtx("story"), [{ role: "user", content: prompt }], () => "", 4096);
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<StoryJson>(text);

  api.update((d) => {
    // The Idea field holds the user's notes: turn them into a polished logline.
    if (data.logline) d.story.logline = String(data.logline);
    if (data.tone) d.story.tone = String(data.tone);
    d.library = d.library ?? [];

    // Global visual style (a library "style" asset; text definition, applied to prompts).
    if (data.style) {
      const styleName = "Estilo del corto";
      let styleAsset = d.library.find((a) => a.type === "style");
      if (!styleAsset) {
        styleAsset = { id: uid("asset"), type: "style", name: styleName, prompt: "", createdAt: Date.now() };
        d.library.push(styleAsset);
      }
      styleAsset.prompt = String(data.style);
      d.styleId = styleAsset.id;
    }

    // Regenerating REPLACES actors & environments, but REUSES same-named ones so
    // they keep their generated image/identifier (no accumulation, no lost
    // thumbnails). Drop only the ones that are no longer present.
    const norm = (s: string) => s.trim().toLowerCase();
    const newCharNames = new Set(
      (data.characters ?? []).map((c) => norm(String(c.name ?? ""))).filter(Boolean),
    );
    const newLocNames = new Set(
      (data.environments ?? []).map((e) => norm(String(e.name ?? ""))).filter(Boolean),
    );
    d.library = d.library.filter((a) => {
      if (a.type === "character") return newCharNames.has(norm(a.name));
      if (a.type === "location") return newLocNames.has(norm(a.name));
      return true; // keep style / others
    });

    // Characters: reuse an existing same-named asset (keep its image), else create.
    if (Array.isArray(data.characters)) {
      d.story.characters = data.characters.map((c) => {
        const name = String(c.name ?? "");
        const description = String(c.description ?? "");
        let asset = d.library.find((a) => a.type === "character" && norm(a.name) === norm(name));
        if (asset) {
          asset.description = description;
          asset.prompt = characterPrompt(name, description);
        } else {
          asset = {
            id: uid("asset"),
            type: "character",
            name,
            description,
            prompt: characterPrompt(name, description),
            createdAt: Date.now(),
          };
          d.library.push(asset);
        }
        return { id: uid("char"), name, description, libraryAssetId: asset.id };
      });
    }

    // Environments: reuse an existing same-named location (keep its image), else create.
    if (Array.isArray(data.environments)) {
      for (const e of data.environments) {
        const name = String(e.name ?? "");
        const description = String(e.description ?? "");
        if (!name) continue;
        const exists = d.library.find((a) => a.type === "location" && norm(a.name) === norm(name));
        if (exists) {
          exists.description = description;
          exists.prompt = environmentPrompt(name, description);
        } else {
          d.library.push({
            id: uid("asset"),
            type: "location",
            name,
            description,
            prompt: environmentPrompt(name, description),
            createdAt: Date.now(),
          });
        }
      }
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
  const nonce = Math.random().toString(36).slice(2, 8); // nudge variety per regeneration

  let prompt: string;
  if (field === "logline") {
    // The Idea field holds the user's notes/brief — turn it into a FRESH logline
    // driven by those notes (not anchored to the old characters/arcs).
    prompt = [
      "Eres guionista. A partir de las NOTAS del usuario, escribe UN logline pulido y atractivo (una sola frase) para un cortometraje.",
      `Notas del usuario: ${story.logline.trim() || "(vacío: invéntalo, breve y original)"}`,
      story.tone ? `Respeta este tono/género: ${story.tone}` : "",
      "Prioriza SIEMPRE las notas del usuario por encima de cualquier otra cosa. Da una propuesta FRESCA y distinta a versiones anteriores (no la repitas).",
      `Semilla de variación: ${nonce}`,
      'Devuelve SOLO un JSON: {"logline":"una frase"}',
      "En español.",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    const ctxLines = [
      `Idea: ${story.logline || "(vacío)"}`,
      `Tono: ${story.tone || "(vacío)"}`,
      `Personajes: ${story.characters.map((c) => `${c.name}: ${c.description}`).join(" | ") || "(vacío)"}`,
      `Arcos: ${story.arcs.map((a) => `${a.title}: ${a.description}`).join(" | ") || "(vacío)"}`,
    ].join("\n");
    const shape =
      field === "tone"
        ? '{"tone":"género/tono/referencias"}'
        : field === "characters"
          ? '{"characters":[{"name":"","description":""}]}'
          : '{"arcs":[{"title":"","description":""}]}';
    prompt = [
      "Eres guionista. Regenera SOLO este campo de la historia, coherente con la idea y el resto.",
      `Campo a regenerar: ${field}`,
      "Historia actual:",
      ctxLines,
      `Devuelve SOLO un JSON con esta forma: ${shape}`,
      "Si regeneras 'characters', incluye SIEMPRE para cada personaje una 'description' visual y concreta (aspecto, vestuario, carácter); nunca la dejes vacía.",
      "Da una variante distinta a la actual (no la repitas literalmente).",
      `Semilla de variación: ${nonce}`,
      "En español.",
    ].join("\n");
  }

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

/**
 * Directly adjust the GLOBAL VISUAL STYLE from a natural-language instruction
 * (the Director applies the change in place). Returns nothing; updates the style
 * asset's prompt so it propagates to every keyframe generation.
 */
export async function editStyle(api: StoreValue, instruction: string): Promise<void> {
  const lib = api.project.library ?? [];
  const styleAsset =
    (api.project.styleId ? lib.find((a) => a.id === api.project.styleId) : undefined) ??
    lib.find((a) => a.type === "style");
  const current = styleAsset?.prompt ?? api.project.story.tone ?? "";
  const prompt = [
    "Eres director de arte. Ajusta la DEFINICIÓN DE ESTILO VISUAL del corto según la petición,",
    "conservando lo que siga siendo válido. Devuelve SOLO el nuevo texto del estilo,",
    "sin comillas, sin JSON, sin explicaciones.",
    `Estilo actual: ${current || "(vacío)"}`,
    `Petición: ${instruction}`,
  ].join("\n");
  const text = await askClaude(api, genCtx("story"), [{ role: "user", content: prompt }], () => "");
  if (!text.trim()) throw new Error(NEED_KEY);
  api.update((d) => {
    d.library = d.library ?? [];
    let a = d.styleId ? d.library.find((x) => x.id === d.styleId) : d.library.find((x) => x.type === "style");
    if (!a) {
      a = { id: uid("asset"), type: "style", name: "Estilo del corto", prompt: "", createdAt: Date.now() };
      d.library.push(a);
      d.styleId = a.id;
    }
    a.prompt = text.trim();
  });
}

interface AssignJson {
  scenes?: Array<{
    number?: number;
    location?: string | null;
    shots?: Array<{ order?: number; characters?: string[] }>;
  }>;
}

/**
 * Claude assigns the ENVIRONMENT per scene and the CHARACTERS per SHOT — matching
 * each plano's action to the assets the user created. Writes scene.locationId,
 * scene.characterIds (union for the scene default) and each shot.characterIds.
 * Names are resolved to library ids locally (robust against id hallucination).
 */
export async function assignReferences(api: StoreValue): Promise<void> {
  const lib = api.project.library ?? [];
  const chars = lib.filter((a) => a.type === "character");
  const locs = lib.filter((a) => a.type === "location");
  if (chars.length === 0 && locs.length === 0) {
    throw new Error("Crea personajes y/o entornos en la Biblioteca antes de asignar.");
  }
  const { scenes, shots } = api.project;
  if (scenes.length === 0) throw new Error("No hay escenas. Genera el guion primero.");

  const sceneLines = scenes
    .map((s) => {
      const shotList = shots
        .filter((x) => x.sceneId === s.id)
        .sort((a, b) => a.order - b.order)
        .map((x) => `    · Plano ${x.order}: ${x.description || x.keyframePrompt}`)
        .join("\n");
      return `${s.number}. ${s.heading} | acción: ${s.action} | diálogo: ${s.dialogue}\n${shotList}`;
    })
    .join("\n");

  const prompt = [
    "Eres director. Asigna el ENTORNO de cada escena y, dentro de cada escena, qué",
    "PERSONAJES aparecen en CADA plano, eligiendo SOLO entre los assets por su nombre exacto.",
    "Personajes disponibles:",
    chars.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`).join("\n") || "(ninguno)",
    "Entornos disponibles:",
    locs.map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`).join("\n") || "(ninguno)",
    "Escenas y planos:",
    sceneLines,
    "Devuelve SOLO un JSON (sin texto extra):",
    '{"scenes":[{"number":1,"location":"Nombre exacto o null","shots":[{"order":1,"characters":["Nombre exacto"]}]}]}',
    "Usa exactamente los nombres de las listas; si ninguno encaja, deja characters:[] o location:null.",
  ].join("\n");

  const text = await askClaude(api, genCtx("storyboard"), [{ role: "user", content: prompt }], () => "", 8192);
  if (!text.trim()) throw new Error(NEED_KEY);
  const data = parseJson<AssignJson>(text);
  if (!Array.isArray(data.scenes)) throw new Error("Claude no devolvió asignaciones.");

  // Accent-insensitive matching (Claude may not echo names byte-for-byte).
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const matchAsset = (name: string, list: typeof chars): string | undefined => {
    const n = norm(name);
    if (!n) return undefined;
    const exact = list.find((a) => norm(a.name) === n);
    if (exact) return exact.id;
    // Fuzzy: one name contained in the other (handles "Colina" vs "Colina del salto").
    const fuzzy = list.find((a) => norm(a.name).includes(n) || n.includes(norm(a.name)));
    return fuzzy?.id;
  };
  const resolveChars = (names?: string[]) =>
    (names ?? [])
      .map((n) => matchAsset(String(n), chars))
      .filter((x): x is string => !!x);

  api.update((d) => {
    for (const r of data.scenes!) {
      const scene =
        d.scenes.find((s) => s.number === r.number) ??
        (typeof r.number === "number" ? d.scenes[r.number - 1] : undefined);
      if (!scene) continue;
      scene.locationId = r.location ? matchAsset(String(r.location), locs) : undefined;
      const sceneShots = d.shots.filter((x) => x.sceneId === scene.id);
      const union = new Set<string>();
      for (const sr of r.shots ?? []) {
        const shot = sceneShots.find((x) => x.order === sr.order);
        if (!shot) continue;
        const ids = resolveChars(sr.characters);
        shot.characterIds = ids;
        ids.forEach((id) => union.add(id));
      }
      scene.characterIds = [...union]; // scene default = everyone present in the scene
    }
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
