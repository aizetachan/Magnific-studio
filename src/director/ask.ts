import type { StoreValue } from "@/state/ProjectStore";
import type { PageContext } from "@/types/pipeline";
import { AnthropicClient, type ClaudeMessage } from "./AnthropicClient";

/**
 * Ask Claude (the brain) within the active page scope and meter the usage.
 * The page scope is injected into the system prompt on every call (§4).
 */
export async function askClaude(
  api: StoreValue,
  ctx: PageContext,
  history: ClaudeMessage[],
  offlineReply: () => string,
): Promise<string> {
  const client = new AnthropicClient(
    api.project.settings.anthropicApiKey,
    api.project.settings.directorModel,
  );
  const reply = await client.send(ctx, history, offlineReply);
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
