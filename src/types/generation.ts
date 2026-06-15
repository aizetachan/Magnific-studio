/**
 * GenerationBlock types — the dual generation layer (§5.5).
 *
 * Generation is ONE block with two coexisting transports and a capability
 * router. The split of responsibility is sacred and must never be re-mixed:
 *
 *   - Anthropic API (Claude) = brain / orchestration / reasoning. Decides,
 *     reformulates, prepares. (Lives in src/director, not here.)
 *   - Magnific (MCP + API) = generation. Executes image / video / audio / edit.
 *
 * Transports are interchangeable behind GenerationTransport. The CapabilityMap
 * is config-only (JSON) so Magnific can extend models/endpoints/capabilities
 * without touching the Router or the pipeline.
 */

export type GenerationKind =
  | "image"
  | "video"
  | "audio"
  | "edit"
  | "concat"
  | "upscale";

export type TransportId = "mcp" | "api";

/**
 * The four execution modes (§5.5):
 *  1. mcp_default     — default conversational operation
 *  2. api_fallback    — MCP can't, API can -> route to API
 *  3. mcp_to_api      — Claude digested & prepared -> hand off to API (Claude-decided, per case)
 *  4. parallel        — API can't fully cover -> API + MCP each produce a part, assembled at the end
 */
export type ExecutionMode =
  | "mcp_default"
  | "api_fallback"
  | "mcp_to_api"
  | "parallel";

export interface GenerationRequest {
  kind: GenerationKind;
  /** Final resolved prompt (Claude may have "digested" it before handoff). */
  prompt: string;
  model: string;
  /** Origin keyframe / reference asset urls or identifiers. */
  references?: string[];
  /**
   * Typed Magnific Library references (characters, styles, locations) for visual
   * consistency. Passed as-is to images_generate / video_generate references[].
   */
  libraryRefs?: Array<{ type: "character" | "style" | "locations" | "product"; identifier: string }>;
  /** Free-form params per model (duration, aspect ratio, camera...). */
  params?: Record<string, unknown>;
  /**
   * Set true by Claude when it has digested & prepared the request and wants the
   * heavy/deterministic execution handed off to the API (mode 3). Claude-decided,
   * per case — never automatic.
   */
  preparedForApi?: boolean;
  /** Optional scope label for metering (e.g. "Escena 3 · Plano 2"). */
  scopeLabel?: string;
}

export interface PreflightEstimate {
  credits: number;
  mode: ExecutionMode;
  transportLabel: string;
  /** Which transport(s) will run, in order. */
  transports: TransportId[];
  notes: string;
}

export interface GenerationResult {
  ok: boolean;
  taskId: string;
  resultUrl?: string;
  creditsCharged: number;
  mode: ExecutionMode;
  transportLabel: string;
  /** The model Magnific actually used (esp. when the request model was "auto"). */
  model?: string;
  error?: string;
  /** For parallel mode: the assembled parts. */
  parts?: Array<{ transport: TransportId; resultUrl?: string }>;
}

/** Live progress for an in-flight async generation (Magnific jobs are async). */
export interface GenerationProgress {
  /** 0..100 */
  progress: number;
  status: "rendering" | "ready" | "failed";
  /** Backend job id, reported once the job starts (for resume after reload). */
  jobId?: string;
}

/** Optional callback a transport calls while a job is in flight. */
export type OnProgress = (p: GenerationProgress) => void;

/** What a transport can do, derived from the CapabilityMap config. */
export interface TransportCapability {
  kinds: GenerationKind[];
  models: string[];
  /** Whether this transport supports async webhooks (vs polling). */
  webhooks: boolean;
  /** Whether this transport exposes the Analytics API for real metering. */
  analytics: boolean;
}

/** The config-only capability registry. Loaded from JSON, editable without code. */
export interface CapabilityMapConfig {
  version: number;
  transports: Record<TransportId, TransportCapability>;
  /** Per-kind credit baselines used for preflight when the API can't quote. */
  creditBaseline: Record<GenerationKind, number>;
}

/** Common interface all transports implement. Add a new one = implement this. */
export interface GenerationTransport {
  readonly id: TransportId;
  readonly label: string;
  /** Live health; an unhealthy transport is skipped by the Router. */
  isHealthy(): boolean;
  /** Whether this transport can serve the request (consulted by the Router). */
  supports(req: GenerationRequest, cap: TransportCapability): boolean;
  /** Execute the request. May be async (Magnific jobs are async). */
  execute(req: GenerationRequest, onProgress?: OnProgress): Promise<GenerationResult>;
}
