import type { PageContext } from "@/types/pipeline";
import { buildSystemPrompt, type ClaudeMessage, type ClaudeReply } from "./AnthropicClient";

/**
 * OpenAI variant of the Director brain (chat.completions). Same contract as
 * AnthropicClient.send() so ask.ts can swap providers transparently. BYO key:
 * called directly from the browser; the key never touches our servers.
 */

const API_URL = "https://api.openai.com/v1/chat/completions";

// Approx. pricing per million tokens (USD) by model family — meter only.
const PRICING: Array<{ prefix: string; inPerMTok: number; outPerMTok: number }> = [
  { prefix: "gpt-5-mini", inPerMTok: 0.25, outPerMTok: 2 },
  { prefix: "gpt-5", inPerMTok: 1.25, outPerMTok: 10 },
  { prefix: "gpt-4.1", inPerMTok: 2, outPerMTok: 8 },
];

function pricingFor(model: string) {
  return PRICING.find((p) => model.startsWith(p.prefix)) ?? PRICING[1];
}

/** OpenAI models offered in Settings. */
export const OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "gpt-4.1"];

export class OpenAIClient {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  get hasKey(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async send(
    ctx: PageContext,
    history: ClaudeMessage[],
    offlineReply: () => string,
    maxTokens = 1024,
    extraSystem = "",
  ): Promise<ClaudeReply> {
    if (!this.hasKey) {
      const text = offlineReply();
      return {
        text,
        inputTokens: Math.ceil((JSON.stringify(ctx).length + text.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        offline: true,
      };
    }

    // The Director prompts are tuned on Claude; be extra strict about output
    // format so JSON-block replies stay machine-parseable.
    const strict =
      "\n- FORMATO: cuando se te pida JSON, responde ÚNICAMENTE con el bloque ```json pedido, sin texto extra.";
    const system = `${buildSystemPrompt(ctx)}${strict}${extraSystem ? `\n\n${extraSystem}` : ""}`;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) {
      throw new Error(`El modelo rechazó la petición: ${choice.message.refusal.slice(0, 160)}`);
    }
    const text = choice?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const price = pricingFor(this.model);
    return {
      text,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens / 1e6) * price.inPerMTok + (outputTokens / 1e6) * price.outPerMTok,
      offline: false,
    };
  }
}
