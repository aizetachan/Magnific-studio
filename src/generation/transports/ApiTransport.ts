import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  TransportCapability,
} from "@/types/generation";
import { placeholderAsset, simulateJob } from "./simulate";

/**
 * ApiTransport — deterministic execution via Magnific's Business REST API.
 *
 * Activated in fallback / handoff modes. In production it brings what the MCP
 * doesn't give cleanly: webhooks for the async queue and the Analytics API
 * (/v1/analytics/team-credit-usage, members, keys, projects) for the real
 * consumption metering required in Settings (§5.3). Requires a Business API key.
 */
export class ApiTransport implements GenerationTransport {
  readonly id = "api" as const;
  readonly label = "ApiTransport";
  private connected: boolean;

  constructor(connected = false) {
    this.connected = connected;
  }

  setConnected(v: boolean) {
    this.connected = v;
  }

  /** Unhealthy until a Business API key is connected. */
  isHealthy(): boolean {
    return this.connected;
  }

  supports(req: GenerationRequest, cap: TransportCapability): boolean {
    return cap.kinds.includes(req.kind) && cap.models.includes(req.model);
  }

  async execute(req: GenerationRequest): Promise<GenerationResult> {
    // Real impl: POST job -> task_id, subscribe webhook_url, settle on callback.
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
      mode: req.preparedForApi ? "mcp_to_api" : "api_fallback",
      transportLabel: this.label,
    };
  }
}
