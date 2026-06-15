import type { Project, Settings, Shot } from "@/types/project";
import { config } from "@/config";

let n = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`;

/** Shot factory — reused by the seed AND by Claude-driven script generation. */
export function newShot(
  sceneId: string,
  order: number,
  opts: {
    description?: string;
    keyframePrompt?: string;
    videoPrompt?: string;
    durationSec?: number;
  } = {},
): Shot {
  const desc = opts.description ?? "";
  return {
    id: uid("shot"),
    sceneId,
    order,
    description: desc,
    keyframePrompt: opts.keyframePrompt ?? desc,
    imageModel: "auto",
    keyframeCreditsEstimate: 60,
    approvedKeyframe: false,
    videoPrompt: opts.videoPrompt ?? desc,
    videoModel: "auto",
    videoDurationSec: opts.durationSec ?? 5,
    videoCreditsEstimate: 150,
    approvedVideo: false,
  };
}

function seedSettings(): Settings {
  return {
    anthropicApiKey: config.seed.anthropicApiKey,
    directorModel: config.seed.directorModel,
    magnificApiKey: config.seed.magnificApiKey,
    magnificApiConnected: config.seed.magnificApiConnected,
    connectionTested: "untested",
  };
}

/** An empty project: nothing generated yet, ready to write from scratch. */
export function createBlankProject(name = "Proyecto sin título"): Project {
  return {
    id: uid("proj"),
    name,
    createdAt: Date.now(),
    story: { logline: "", characters: [], arcs: [], tone: "" },
    scenes: [],
    shots: [],
    delivery: {},
    consumption: { events: [] },
    library: [],
    settings: seedSettings(),
    gates: {
      story: "in_progress",
      script: "locked",
      storyboard: "locked",
      production: {},
      delivery: "locked",
    },
  };
}

/** A fresh project with example data so the pipeline is explorable end-to-end. */
export function createSeedProject(): Project {
  const now = Date.now();
  const sceneA = uid("scene");
  const sceneB = uid("scene");
  const sceneC = uid("scene");

  const shot = (sceneId: string, order: number, desc: string) =>
    newShot(sceneId, order, { description: desc });

  return {
    id: uid("proj"),
    name: "La Esfera",
    createdAt: now,
    story: {
      logline:
        "Una restauradora descubre que una esfera hallada en un museo reescribe la memoria de quien la toca.",
      characters: [
        {
          id: uid("char"),
          name: "Lía",
          description: "Restauradora de arte, metódica, escéptica con lo inexplicable.",
        },
        {
          id: uid("char"),
          name: "El Conservador",
          description: "Director del museo que sabe más de la esfera de lo que admite.",
        },
      ],
      arcs: [
        {
          id: uid("arc"),
          title: "Descubrimiento",
          description: "Lía nota anomalías en sus recuerdos tras manipular la pieza.",
        },
        {
          id: uid("arc"),
          title: "Confrontación",
          description: "Decide destruir la esfera aun a costa de perder su pasado.",
        },
      ],
      tone: "Thriller intimista de ciencia ficción. Referencias: Arrival, Annihilation.",
    },
    scenes: [
      {
        id: sceneA,
        number: 1,
        heading: "INT. SALA DE RESTAURACIÓN — NOCHE",
        action: "Lía limpia una esfera metálica. Al rozarla, las luces parpadean.",
        dialogue: "LÍA: (susurro) ¿De dónde has salido tú?",
        durationSec: 12,
      },
      {
        id: sceneB,
        number: 2,
        heading: "INT. ARCHIVO DEL MUSEO — NOCHE",
        action: "Busca documentos. El Conservador la observa desde la puerta.",
        dialogue: "CONSERVADOR: No todo lo que se conserva quiere ser recordado.",
        durationSec: 18,
      },
      {
        id: sceneC,
        number: 3,
        heading: "EXT. AZOTEA — AMANECER",
        action: "Lía sostiene la esfera sobre el vacío, dudando.",
        dialogue: "LÍA: Si te suelto, ¿quién seré mañana?",
        durationSec: 15,
      },
    ],
    shots: [
      shot(sceneA, 1, "Plano detalle de la esfera reflejando el rostro de Lía."),
      shot(sceneA, 2, "Plano medio de Lía, las luces parpadean a su alrededor."),
      shot(sceneB, 1, "Plano general del archivo en penumbra, estanterías infinitas."),
      shot(sceneB, 2, "Contraplano: el Conservador recortado en la puerta."),
      shot(sceneC, 1, "Gran angular de la azotea al amanecer, Lía de espaldas."),
      shot(sceneC, 2, "Plano detalle de la mano abriéndose sobre la esfera."),
    ],
    delivery: {},
    consumption: { events: [] },
    library: [
      { id: uid("lib"), type: "character", name: "Lía (ref)" },
      { id: uid("lib"), type: "location", name: "Museo nocturno" },
    ],
    settings: {
      anthropicApiKey: config.seed.anthropicApiKey,
      directorModel: config.seed.directorModel,
      magnificApiKey: config.seed.magnificApiKey,
      magnificApiConnected: config.seed.magnificApiConnected,
      connectionTested: "untested",
    },
    gates: {
      story: "in_progress",
      script: "locked",
      storyboard: "locked",
      production: {},
      delivery: "locked",
    },
  };
}
