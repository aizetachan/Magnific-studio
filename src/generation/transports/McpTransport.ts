import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  TransportCapability,
} from "@/types/generation";
import { placeholderAsset, simulateJob } from "./simulate";

/**
 * McpTransport — the default conversational generation layer.
 *
 * In the MVP it talks to the Magnific MCP server (OAuth, no API key, already
 * available) — tools like images_generate / video_generate / video_concatenate.
 * Here the async job is simulated, but the contract matches the real MCP:
 * conversational, "digest & prepare", broadest kind coverage.
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
    // Maps to the real Magnific MCP tool by kind (images_generate, video_generate,
    // video_concatenate, ...). Simulated here as an async task.
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
