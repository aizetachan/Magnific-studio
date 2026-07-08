import type { StoreValue } from "@/state/ProjectStore";
import type { PageContext } from "@/types/pipeline";
import { AnthropicClient, type ClaudeMessage } from "./AnthropicClient";
import { OpenAIClient } from "./OpenAIClient";

/**
 * Ask Claude (the brain) within the active page scope and meter the usage.
 * The page scope is injected into the system prompt on every call (§4).
 */
/** Compact library digest injected into EVERY Director call: the asset
 * descriptions and the active style definition must ALWAYS be considered. */
function librarySystem(api: StoreValue): string {
  const lib = api.project.library ?? [];
  const clip = (t?: string) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
  const lines: string[] = [];
  for (const a of lib) {
    if (a.type === "style") continue;
    const desc = clip(a.description || a.prompt);
    if (desc) lines.push(`- ${a.type === "location" ? "Entorno" : "Personaje"} «${a.name}»: ${desc}`);
    else lines.push(`- ${a.type === "location" ? "Entorno" : "Personaje"} «${a.name}» (sin descripción aún)`);
  }
  const styleAsset = api.project.styleId ? lib.find((a) => a.id === api.project.styleId) : undefined;
  const style = clip(styleAsset?.prompt);
  if (lines.length === 0 && !style) return "";
  return [
    "## Biblioteca del proyecto (OBLIGATORIO tenerla siempre en cuenta)",
    "Usa estas descripciones como fuente de verdad para personajes y entornos al proponer, escribir o revisar cualquier contenido:",
    ...lines,
    ...(style ? ["", `Estilo global ACTIVO (aplícalo como directriz visual en todo): ${style}`] : []),
  ].join("\n");
}

export async function askClaude(
  api: StoreValue,
  ctx: PageContext,
  history: ClaudeMessage[],
  offlineReply: () => string,
  maxTokens = 1024,
  extraSystem = "",
): Promise<string> {
  const s = api.project.settings;
  const libSys = librarySystem(api);
  if (libSys) extraSystem = extraSystem ? `${libSys}\n\n${extraSystem}` : libSys;
  const client =
    s.directorProvider === "openai"
      ? new OpenAIClient(s.openaiApiKey ?? "", s.openaiModel ?? "gpt-5")
      : new AnthropicClient(s.anthropicApiKey, s.directorModel);
  const reply = await client.send(ctx, history, offlineReply, maxTokens, extraSystem);
  api.meter({
    phase: ctx.phase,
    scope: ctx.implicitReferent,
    kind: "claude",
    label: reply.offline ? "director (offline)" : "director",
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    claudeCostUsd: reply.costUsd,
  });
  return reply.text;
}
