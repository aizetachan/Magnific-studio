import type { ActionArg, BlockAction, PageContext } from "@/types/pipeline";
import type { PhaseId } from "@/types/project";

/**
 * Orchestration: in the MVP Claude is the central orchestrator. It detects
 * intent from the Director bar text (or a contextual click) and, given the
 * active PageContext, fires the right block action — or softly redirects if the
 * request belongs to another phase (§4, §5.4).
 *
 * Capability tags are canonical: a BlockAction's `id` IS its capability tag, and
 * PageContext.allowedActions / blockedActions list those same tags. This keeps
 * scope enforcement data-driven and decoupled from any single block.
 */

export interface Orchestration {
  reply: string;
  action?: BlockAction;
  arg?: ActionArg;
  /** True when the request was out of scope and redirected instead of run. */
  redirected: boolean;
}

/** Keyword -> capability tag. First match wins. */
const INTENT_RULES: Array<{ tag: string; words: RegExp }> = [
  { tag: "develop_story", words: /\b(historia|logline|idea|sinopsis|premisa)\b/i },
  { tag: "rewrite_story", words: /\b(arco|tono|personaje|reescrib\w*|género)\b/i },
  { tag: "generate_script", words: /\b(guion|guión|escrib\w* el guion)\b/i },
  { tag: "rewrite_scene", words: /\b(reescrib\w* (esta )?escena|ritmo|duraci[óo]n)\b/i },
  { tag: "generate_keyframe", words: /\b(keyframe|storyboard|imagen|ilustr\w*)\b/i },
  { tag: "vary_keyframe", words: /\b(var[íi]a|ángulo|angulo|variant\w*)\b/i },
  { tag: "validate_storyboard", words: /\bvalida\w* (el )?storyboard\b/i },
  { tag: "generate_video", words: /\b(v[íi]deo|render\w*|prod[úu]ce\w*|cinematogr\w*|plano)\b/i },
  { tag: "validate_scene", words: /\b(escena validada|valida\w* (la )?escena)\b/i },
  { tag: "assemble_final", words: /\b(ensambl\w*|concaten\w*|montaje|entrega)\b/i },
];

/** Where each capability lives, for a helpful redirect message. */
const TAG_PHASE: Record<string, { phase: PhaseId; label: string }> = {
  develop_story: { phase: "story", label: "Historia" },
  rewrite_story: { phase: "story", label: "Historia" },
  generate_script: { phase: "script", label: "Guion" },
  rewrite_scene: { phase: "script", label: "Guion" },
  generate_keyframe: { phase: "storyboard", label: "Storyboard" },
  vary_keyframe: { phase: "storyboard", label: "Storyboard" },
  validate_storyboard: { phase: "storyboard", label: "Storyboard" },
  generate_video: { phase: "production", label: "Producción" },
  validate_scene: { phase: "production", label: "Producción" },
  assemble_final: { phase: "delivery", label: "Entrega" },
};

function detectTag(text: string): string | undefined {
  for (const rule of INTENT_RULES) {
    if (rule.words.test(text)) return rule.tag;
  }
  return undefined;
}

/** Extract "el plano 2" / "escena 3" numbers for implicit reference resolution. */
function extractShotNumber(text: string): number | undefined {
  const m = text.match(/\bplano\s+(\d+)\b/i);
  return m ? Number(m[1]) : undefined;
}

interface VisibleShot {
  id: string;
  order: number;
}

export function resolveIntent(
  text: string,
  ctx: PageContext,
  actions: BlockAction[],
): Orchestration {
  const tag = detectTag(text);

  if (!tag) {
    return {
      reply:
        "No estoy seguro de qué acción quieres en esta fase. Prueba con los botones contextuales de la página o dime, por ejemplo, “" +
        (ctx.allowedActions[0] ?? "desarrolla la historia") +
        "”.",
      redirected: false,
    };
  }

  // Out-of-scope: the capability belongs to another phase -> soft redirect.
  if (ctx.blockedActions.includes(tag)) {
    const dest = TAG_PHASE[tag];
    return {
      reply: `Eso es de la fase de ${dest?.label ?? "otra fase"}; estás en ${ctx.phaseLabel}. Avancemos cuando esta fase esté validada y lo retomamos allí.`,
      redirected: true,
    };
  }

  // In scope but this block doesn't currently allow it (gate state etc.).
  if (!ctx.allowedActions.includes(tag)) {
    return {
      reply: `Ahora mismo no puedo hacer eso en ${ctx.phaseLabel}. Revisa el estado de la fase.`,
      redirected: true,
    };
  }

  const action = actions.find((a) => a.id === tag && a.enabled);
  if (!action) {
    return {
      reply: `La acción “${tag}” no está disponible todavía (puede requerir aprobar pasos previos).`,
      redirected: false,
    };
  }

  // Resolve the implicit referent: "el plano 2" -> shot 2 of the ACTIVE scene/view.
  const arg: ActionArg = { freeText: text };
  const shotNumber = extractShotNumber(text);
  if (shotNumber != null) {
    const shots = (ctx.visibleObjects["shots"] as VisibleShot[] | undefined) ?? [];
    const target = shots.find((s) => s.order === shotNumber);
    if (target) {
      arg.shotId = target.id;
    }
  }
  if (typeof ctx.visibleObjects["activeSceneId"] === "string") {
    arg.sceneId = ctx.visibleObjects["activeSceneId"] as string;
  }

  const refNote = arg.shotId
    ? ` Lo aplico al plano ${shotNumber} de ${ctx.implicitReferent}.`
    : "";
  return {
    reply: `Hecho: ${action.label}.${refNote}`,
    action,
    arg,
    redirected: false,
  };
}
