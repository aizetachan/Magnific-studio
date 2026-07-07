import type { PageContext } from "@/types/pipeline";
import { config } from "@/config";

/**
 * Thin client over the Anthropic Messages API (/v1/messages).
 *
 * Claude is the BRAIN of the pipeline (never the generator). The full page
 * scope is injected into the system prompt on EVERY call because Claude has no
 * memory between requests (§4). When no API key is connected the client returns
 * a local heuristic reply so the MVP stays usable offline — but the request
 * shape, scope injection and usage accounting are real.
 *
 * By default the request goes through the dev-server proxy (`/api/anthropic`),
 * so the call is same-origin and needs no CORS workaround. Point
 * VITE_ANTHROPIC_BASE at https://api.anthropic.com to call the API directly
 * (the direct-browser-access header is then sent automatically).
 */

const API_URL = `${config.anthropicBase}/v1/messages`;

export interface ClaudeReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Rough cost estimate in USD for the consumption meter. */
  costUsd: number;
  /** True when produced by the offline heuristic (no API key). */
  offline: boolean;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

// Approx. pricing per million tokens (USD) by model family. Used only for the meter.
const PRICING: Array<{ prefix: string; inPerMTok: number; outPerMTok: number }> = [
  { prefix: "claude-fable", inPerMTok: 10, outPerMTok: 50 },
  { prefix: "claude-opus", inPerMTok: 5, outPerMTok: 25 },
  { prefix: "claude-sonnet", inPerMTok: 3, outPerMTok: 15 },
  { prefix: "claude-haiku", inPerMTok: 1, outPerMTok: 5 },
];

function pricingFor(model: string) {
  return PRICING.find((p) => model.startsWith(p.prefix)) ?? PRICING[1];
}

export function buildSystemPrompt(ctx: PageContext): string {
  return [
    "Eres el Director de Magnific Studio: un asistente de producción narrativa,",
    "presente pero no invasivo. Actúas SOLO dentro del scope de la página activa.",
    "",
    "## Scope de página activa (inyectado en cada request)",
    `- fase: ${ctx.phase} (${ctx.phaseLabel})`,
    `- referente_implícito: ${ctx.implicitReferent}`,
    `- acciones_permitidas: ${ctx.allowedActions.join(", ")}`,
    `- acciones_bloqueadas: ${ctx.blockedActions.join(", ") || "—"}`,
    "- objetos_visibles:",
    "```json",
    JSON.stringify(ctx.visibleObjects, null, 2),
    "```",
    "",
    "## Reglas",
    '- Resuelve referencias implícitas con el referente_implícito (ej. "el plano 2" = el plano 2 de la vista activa).',
    "- Si te piden algo fuera de fase (una acción bloqueada), NO lo ejecutes: redirige con suavidad",
    "  indicando en qué fase se hace y qué falta para llegar.",
    "- Sé conciso. No generas imágenes ni vídeo tú mismo: eso lo ejecuta la capa de generación de Magnific.",
  ].join("\n");
}

export class AnthropicClient {
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
  ): Promise<ClaudeReply> {
    if (!this.hasKey) {
      const text = offlineReply();
      return {
        text,
        inputTokens: estimateTokens(JSON.stringify(ctx) + serialize(history)),
        outputTokens: estimateTokens(text),
        costUsd: 0,
        offline: true,
      };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      // Trim to avoid "invalid x-api-key" from a pasted trailing space/newline.
      "x-api-key": this.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      // The browser always sends an Origin header (even through the Vite proxy),
      // so Anthropic treats the call as CORS and REQUIRES this header. Always set.
      "anthropic-dangerous-direct-browser-access": "true",
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: buildSystemPrompt(ctx),
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    // Fable 5 safety classifiers can decline a request with HTTP 200 and empty
    // content — surface it instead of returning a silently-empty reply.
    if (data.stop_reason === "refusal") {
      throw new Error("El modelo rechazó la petición (stop_reason: refusal). Reformula o prueba otro modelo.");
    }
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const price = pricingFor(this.model);
    return {
      text,
      inputTokens,
      outputTokens,
      costUsd:
        (inputTokens / 1e6) * price.inPerMTok +
        (outputTokens / 1e6) * price.outPerMTok,
      offline: false,
    };
  }
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function serialize(h: ClaudeMessage[]): string {
  return h.map((m) => m.content).join(" ");
}
