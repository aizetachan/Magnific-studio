import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  TransportCapability,
} from "@/types/generation";
import { config } from "@/config";
import { placeholderAsset, simulateJob } from "./simulate";

/**
 * McpTransport — the default conversational generation layer.
 *
 * In the MVP it talks to the Magnific MCP server (OAuth, no API key, already
 * available) — tools like images_generate / video_generate / video_concatenate.
 * Claude orchestrates those tools, which is exactly what the Director backend
 * does (server/index.mjs): when live, this transport POSTs the request to
 * `${directorBase}/api/director/mcp-generate`, where Claude runs the MCP loop
 * server-side (OAuth/session off the browser). Otherwise it simulates.
 *
 * The MCP "never falls": if it can't cover a request, supports() returns false
 * and the Router simply routes that request elsewhere.
 */
export class McpTransport implements GenerationTransport {
  readonly id = "mcp" as const;
  readonly label = "McpTransport";
  private healthy = true;

  setHealthy(v: boolean) {
    this.healthy = v;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  supports(req: GenerationRequest, cap: TransportCapability): boolean {
    return cap.kinds.includes(req.kind) && cap.models.includes(req.model);
  }

  async execute(req: GenerationRequest): Promise<GenerationResult> {
    if (config.magnificLive) {
      try {
        return await this.executeViaDirector(req);
      } catch (err) {
        const sim = await this.simulate(req);
        return {
          ...sim,
          error: `director fallback to simulation: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }
    return this.simulate(req);
  }

  /** Real path: the Director backend runs Claude with the Magnific MCP tools. */
  private async executeViaDirector(
    req: GenerationRequest,
  ): Promise<GenerationResult> {
    const res = await fetch(`${config.directorBase}/api/director/mcp-generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: req.kind,
        prompt: req.prompt,
        model: req.model,
        references: req.references,
        params: req.params,
      }),
    });
    if (!res.ok) throw new Error(`director ${res.status}`);
    const data = (await res.json()) as {
      ok: boolean;
      resultUrl?: string;
      credits?: number;
      error?: string;
    };
    return {
      ok: data.ok && !!data.resultUrl,
      taskId: `mcp_${Date.now().toString(36)}`,
      resultUrl: data.resultUrl,
      creditsCharged: data.credits ?? 0,
      mode: "mcp_default",
      transportLabel: this.label,
      error: data.error,
    };
  }

  private async simulate(req: GenerationRequest): Promise<GenerationResult> {
    const { taskId, resultUrl, credits } = await simulateJob({
      kind: req.kind,
      prompt: req.prompt,
      makeUrl: () => placeholderAsset(req.kind, req.prompt),
    });
    return {
      ok: true,
      taskId,
      resultUrl,
      creditsCharged: credits,
      mode: "mcp_default",
      transportLabel: this.label,
    };
  }
}
