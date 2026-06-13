import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  TransportCapability,
} from "@/types/generation";
import { config } from "@/config";
import { placeholderAsset, simulateJob } from "./simulate";

/**
 * ApiTransport — deterministic execution via Magnific's Business REST API.
 *
 * Activated in fallback / handoff modes. In production it brings what the MCP
 * doesn't give cleanly: webhooks for the async queue and the Analytics API
 * (/v1/analytics/team-credit-usage, members, keys, projects) for the real
 * consumption metering required in Settings (§5.3). Requires a Business API key.
 *
 * Connect-ready: when VITE_MAGNIFIC_LIVE=true, an API key is present, and the
 * transport is marked connected, execute() makes a real POST -> poll call
 * against the configured base (proxied via /api/magnific). Otherwise — and on
 * any error — it falls back to a simulated job so the app never breaks.
 */
export class ApiTransport implements GenerationTransport {
  readonly id = "api" as const;
  readonly label = "ApiTransport";
  private connected: boolean;
  private apiKey = "";

  constructor(connected = false) {
    this.connected = connected;
  }

  setConnected(v: boolean) {
    this.connected = v;
  }

  setAuth(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Unhealthy until a Business API key is connected. */
  isHealthy(): boolean {
    return this.connected;
  }

  supports(req: GenerationRequest, cap: TransportCapability): boolean {
    return cap.kinds.includes(req.kind) && cap.models.includes(req.model);
  }

  async execute(req: GenerationRequest): Promise<GenerationResult> {
    const mode = req.preparedForApi ? "mcp_to_api" : "api_fallback";

    if (config.magnificLive && this.connected && this.apiKey) {
      try {
        return await this.executeLive(req, mode);
      } catch (err) {
        // Live path failed (misconfig, network, schema) — degrade to simulation
        // rather than breaking the user's flow, and surface the reason.
        const sim = await this.simulate(req, mode);
        return {
          ...sim,
          error: `live API fallback to simulation: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }

    return this.simulate(req, mode);
  }

  /**
   * Real async job against the Magnific REST API (Magnific pattern:
   * POST -> task_id -> GET /{task-id}). Endpoint paths are config-driven so the
   * exact account/version surface can be set without code changes.
   */
  private async executeLive(
    req: GenerationRequest,
    mode: "mcp_to_api" | "api_fallback",
  ): Promise<GenerationResult> {
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    const createUrl = `${config.magnificApiBase}${config.magnificGeneratePath}`;
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: req.kind,
        model: req.model,
        prompt: req.prompt,
        references: req.references,
        params: req.params,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`create ${createRes.status}`);
    }
    const created = (await createRes.json()) as {
      task_id?: string;
      id?: string;
    };
    const taskId = created.task_id ?? created.id ?? "task";

    // Poll until the job settles (webhooks are preferred in production).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${createUrl}/${taskId}`, { headers });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status?: string;
        result_url?: string;
        url?: string;
        credits?: number;
      };
      if (data.status === "ready" || data.status === "completed") {
        return {
          ok: true,
          taskId,
          resultUrl: data.result_url ?? data.url,
          creditsCharged: data.credits ?? 0,
          mode,
          transportLabel: this.label,
        };
      }
      if (data.status === "failed") {
        return {
          ok: false,
          taskId,
          creditsCharged: 0,
          mode,
          transportLabel: this.label,
          error: "job failed",
        };
      }
    }
    throw new Error("poll timeout");
  }

  private async simulate(
    req: GenerationRequest,
    mode: "mcp_to_api" | "api_fallback",
  ): Promise<GenerationResult> {
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
      mode,
      transportLabel: this.label,
    };
  }
}
