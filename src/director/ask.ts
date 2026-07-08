import type { StoreValue } from "@/state/ProjectStore";
import type { PageContext } from "@/types/pipeline";
import { AnthropicClient, type ClaudeMessage } from "./AnthropicClient";
import { OpenAIClient } from "./OpenAIClient";

/**
 * Ask Claude (the brain) within the active page scope and meter the usage.
 * The page scope is injected into the system prompt on every call (§4).
 */
export async function askClaude(
  api: StoreValue,
  ctx: PageContext,
  history: ClaudeMessage[],
  offlineReply: () => string,
  maxTokens = 1024,
  extraSystem = "",
): Promise<string> {
  const s = api.project.settings;
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
