import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  PreflightEstimate,
  TransportId,
} from "@/types/generation";
import { CapabilityMap } from "./CapabilityMap";
import { Router } from "./Router";
import { McpTransport } from "./transports/McpTransport";
import { ApiTransport } from "./transports/ApiTransport";

/**
 * GenerationBlock — ONE block, two coexisting transports, one capability router
 * (§5.5). This is what Magnific receives: dual-path generation that scales by
 * editing config (CapabilityMap) or adding a transport, without touching the
 * pipeline.
 *
 * Responsibility split is sacred: Claude (src/director) is the brain; this block
 * only executes generation (image/video/audio/edit).
 */
export class GenerationBlock {
  readonly capabilities: CapabilityMap;
  readonly mcp: McpTransport;
  readonly api: ApiTransport;
  private transports: Record<TransportId, GenerationTransport>;
  private router: Router;

  constructor(opts?: { apiConnected?: boolean }) {
    this.capabilities = new CapabilityMap();
    this.mcp = new McpTransport();
    this.api = new ApiTransport(opts?.apiConnected ?? false);
    this.transports = { mcp: this.mcp, api: this.api };
    this.router = new Router(this.capabilities, this.transports);
  }

  /** Reflect Settings connection state into the API transport health. */
  setApiConnected(connected: boolean) {
    this.api.setConnected(connected);
  }

  /** Provide the Magnific REST API key to the API transport (live calls). */
  setMagnificAuth(apiKey: string) {
    this.api.setAuth(apiKey);
  }

  /** Add or replace a transport at runtime (interchangeable by design). */
  registerTransport(t: GenerationTransport) {
    this.transports[t.id] = t;
    this.router = new Router(this.capabilities, this.transports);
  }

  /** Cost preflight shown before any generation call. */
  preflight(req: GenerationRequest): PreflightEstimate {
    return this.router.preflight(req);
  }

  /**
   * Execute a request through the chosen mode. For parallel mode each transport
   * produces its part and the block assembles them at the end (division of work,
   * not redundancy / not "first to respond").
   */
  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const { mode, transports } = this.router.decide(req);

    if (transports.length === 0) {
      return {
        ok: false,
        taskId: "none",
        creditsCharged: 0,
        mode,
        transportLabel: "—",
        error: "Ningún transporte sano soporta esta solicitud.",
      };
    }

    if (mode === "parallel") {
      // Split the work: API renders one part, MCP the other; assemble.
      const [apiPart, mcpPart] = await Promise.all([
        this.transports.api.execute({
          ...req,
          params: { ...req.params, part: "primary" },
        }),
        this.transports.mcp.execute({
          ...req,
          params: { ...req.params, part: "secondary" },
        }),
      ]);
      return {
        ok: apiPart.ok && mcpPart.ok,
        taskId: `${apiPart.taskId}+${mcpPart.taskId}`,
        // Assembled result: the primary (API) part is the spine.
        resultUrl: apiPart.resultUrl ?? mcpPart.resultUrl,
        creditsCharged: apiPart.creditsCharged + mcpPart.creditsCharged,
        mode: "parallel",
        transportLabel: `${this.transports.api.label} + ${this.transports.mcp.label}`,
        parts: [
          { transport: "api", resultUrl: apiPart.resultUrl },
          { transport: "mcp", resultUrl: mcpPart.resultUrl },
        ],
      };
    }

    // mcp_default | api_fallback | mcp_to_api -> single transport executes.
    const primary = transports[transports.length - 1]; // api for handoff, else mcp
    const result = await this.transports[primary].execute(req);
    return { ...result, mode };
  }
}
