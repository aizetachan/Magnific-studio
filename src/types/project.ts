/**
 * Domain model for a Magnific Studio project.
 *
 * The model is deliberately flat and serializable (JSON export/import) so the
 * whole project state can be persisted to Magnific's backend later without
 * touching the blocks. Nothing here depends on React.
 */

import type { ExecutionMode, GenerationKind } from "./generation";

export type PhaseId =
  | "story"
  | "script"
  | "storyboard"
  | "production"
  | "delivery";

export type GateState = "locked" | "in_progress" | "ready" | "validated";

/** Async generation job lifecycle (Magnific pattern: POST -> task_id -> GET). */
export type JobStatus = "idle" | "queued" | "rendering" | "ready" | "failed";

export interface Job {
  id: string;
  kind: GenerationKind;
  status: JobStatus;
  /** Execution mode chosen by the GenerationBlock Router. */
  mode: ExecutionMode;
  /** Human-readable transport label, e.g. "McpTransport" / "ApiTransport + McpTransport". */
  transportLabel: string;
  progress: number; // 0..100
  resultUrl?: string;
  error?: string;
  /** Magnific credits actually charged once the job settles. */
  creditsCharged?: number;
  taskId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Optional reference image from the shared library. */
  photoUrl?: string;
  /** library_create identifier when promoted to the shared library. */
  libraryId?: string;
}

export interface Arc {
  id: string;
  title: string;
  description: string;
}

export interface Story {
  logline: string;
  characters: Character[];
  arcs: Arc[];
  tone: string; // tono / género / referencias
}

export interface Scene {
  id: string;
  number: number;
  heading: string; // INT. NAVE — NOCHE
  action: string;
  dialogue: string;
  /** Estimated screen duration in seconds (used by "ajustar ritmo"). */
  durationSec: number;
}

/**
 * A Shot is the atomic production unit. It carries BOTH the storyboard keyframe
 * (approved in the Storyboard gate, over the whole short) and the video job
 * (approved per-scene in Production). The two approvals are independent on
 * purpose: storyboard validates the plan, production validates the burn.
 */
export interface Shot {
  id: string;
  sceneId: string;
  order: number;
  description: string;

  // --- Storyboard (keyframe) ---
  keyframePrompt: string;
  imageModel: string;
  keyframeUrl?: string;
  keyframeJob?: Job;
  keyframeCreditsEstimate: number;
  approvedKeyframe: boolean;

  // --- Production (video) ---
  videoPrompt: string;
  videoModel: string;
  videoDurationSec: number;
  videoUrl?: string;
  videoJob?: Job;
  videoCreditsEstimate: number;
  approvedVideo: boolean;
}

export interface Delivery {
  finalVideoJob?: Job;
  finalVideoUrl?: string;
  exportedSpaceUrl?: string;
}

/** A single metered event, for the per-phase / per-scene / per-shot history. */
export interface ConsumptionEvent {
  id: string;
  at: number;
  phase: PhaseId | "settings";
  /** Free-form scope label, e.g. "Escena 3 · Plano 2". */
  scope: string;
  kind: "claude" | "magnific";
  label: string;
  // Claude usage
  inputTokens?: number;
  outputTokens?: number;
  claudeCostUsd?: number;
  // Magnific usage
  credits?: number;
}

export interface Consumption {
  events: ConsumptionEvent[];
}

export interface LibraryAsset {
  id: string;
  type: "character" | "location" | "style" | "element";
  name: string;
  thumbnailUrl?: string;
  /** Mirrors Magnific library entry identifier when synced. */
  magnificIdentifier?: string;
}

export interface Settings {
  /** User's Anthropic API key. Kept only in memory in the MVP. Never hardcoded. */
  anthropicApiKey: string;
  /** Default model for director tasks (configurable). */
  directorModel: string;
  /** Whether the Magnific Business REST API (ApiTransport) is connected. */
  magnificApiConnected: boolean;
  connectionTested: "untested" | "ok" | "failed";
}

export interface Gates {
  story: GateState;
  script: GateState;
  storyboard: GateState;
  /** Per-scene gates for production, keyed by sceneId. */
  production: Record<string, GateState>;
  delivery: GateState;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  story: Story;
  scenes: Scene[];
  shots: Shot[];
  delivery: Delivery;
  consumption: Consumption;
  library: LibraryAsset[];
  settings: Settings;
  gates: Gates;
}
