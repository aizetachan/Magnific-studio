import type {
  ExecutionMode,
  GenerationRequest,
  GenerationTransport,
  PreflightEstimate,
  TransportId,
} from "@/types/generation";
import { CapabilityMap } from "./CapabilityMap";

/**
 * The Router chooses the execution mode for each request, consulting the
 * CapabilityMap and the live health of each transport. It executes what Claude
 * decides — it never decides the MCP->API handoff on its own (that is
 * Claude-decided, per case, via req.preparedForApi).
 */
export class Router {
  constructor(
    private capabilities: CapabilityMap,
    private transports: Record<TransportId, GenerationTransport>,
  ) {}

  private can(id: TransportId, req: GenerationRequest): boolean {
    const t = this.transports[id];
    return t.isHealthy() && t.supports(req, this.capabilities.capabilityOf(id));
  }

  /**
   * Decide the mode and the ordered transports involved. Priority:
   *  1) mcp_to_api  — Claude prepared the request and wants API to execute.
   *  2) parallel    — work must be split (API can't fully cover) -> API + MCP.
   *  3) mcp_default — default conversational path.
   *  4) api_fallback — MCP can't, API can.
   */
  decide(req: GenerationRequest): {
    mode: ExecutionMode;
    transports: TransportId[];
  } {
    const mcpOk = this.can("mcp", req);
    const apiOk = this.can("api", req);

    if (req.preparedForApi && apiOk) {
      return { mode: "mcp_to_api", transports: ["mcp", "api"] };
    }
    if (req.params?.["parallel"] === true && mcpOk && apiOk) {
      return { mode: "parallel", transports: ["api", "mcp"] };
    }
    if (mcpOk) {
      return { mode: "mcp_default", transports: ["mcp"] };
    }
    if (apiOk) {
      return { mode: "api_fallback", transports: ["api"] };
    }
    // No healthy transport supports it — surface as an error path.
    return { mode: "mcp_default", transports: [] };
  }

  /** Credit/cost preflight shown to the user BEFORE executing (§5.3, §5.6). */
  preflight(req: GenerationRequest): PreflightEstimate {
    const { mode, transports } = this.decide(req);
    const base = this.capabilities.baselineCredits(req.kind);
    // Parallel runs two partial renders + an assembly step.
    const credits = mode === "parallel" ? Math.round(base * 1.2 + 2) : base;
    const label = transports.map((t) => this.transports[t].label).join(" + ");
    return {
      credits,
      mode,
      transports,
      transportLabel: label || "—",
      notes: NOTES[mode],
    };
  }
}

const NOTES: Record<ExecutionMode, string> = {
  mcp_default: "Operación conversacional por defecto (MCP).",
  api_fallback: "MCP no cubre esta solicitud; se ejecuta por API REST.",
  mcp_to_api:
    "Claude ya digirió y preparó la solicitud; ejecución determinista en API.",
  parallel:
    "La API no cubre todo; API y MCP producen su parte y se ensamblan al final.",
};
