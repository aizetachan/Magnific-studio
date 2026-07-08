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
  /** Backend job id, to resume polling after a reload (survive close/reload). */
  backendJobId?: string;
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
  /** Linked Library asset (local id) that holds this character's visual ref. */
  libraryAssetId?: string;
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
  /** Library location asset id for this scene's environment (consistency). */
  locationId?: string;
  /** Library character asset ids that appear in this scene (consistency). */
  characterIds?: string[];
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
  /** All keyframes generated for this shot (history; the active one is keyframeUrl). */
  keyframeHistory?: string[];
  keyframeJob?: Job;
  keyframeCreditsEstimate: number;
  approvedKeyframe: boolean;

  // --- Reference overrides (consistency) ---
  // When set, override the scene's assignment for THIS shot; undefined = inherit.
  locationId?: string;
  characterIds?: string[];

  // --- Production (video) ---
  videoPrompt: string;
  videoModel: string;
  /** How the keyframe feeds the video: "keyframe" (start frame) or "reference". */
  videoRefMode?: "keyframe" | "reference";
  videoDurationSec: number;
  videoUrl?: string;
  /** All videos generated for this shot (history; the active one is videoUrl). */
  videoHistory?: string[];
  videoJob?: Job;
  videoCreditsEstimate: number;
  approvedVideo: boolean;
}

export interface Delivery {
  finalVideoJob?: Job;
  finalVideoUrl?: string;
  exportedSpaceUrl?: string;
}

/**
 * Timeline edit for the in-app montage (Montaje tab). The video clips reference
 * produced shots; the audio placements reference generated AudioTracks. All
 * fields are overrides on top of the auto-derived order so the editor can stay
 * in sync as new clips/tracks are produced.
 */
export interface EditClip {
  /** Unique timeline-entry id (a shot can appear more than once after a split). */
  id: string;
  shotId: string;
  order: number;
  included: boolean;
  /** Mute this clip's native audio in playback and the final render. */
  muted?: boolean;
  /** Trim within the source clip, in seconds. */
  inSec?: number;
  outSec?: number;
}

export interface EditAudioPlacement {
  /** References an AudioTrack.id. */
  trackId: string;
  /** Where this track starts on the final timeline (seconds). */
  offsetSec: number;
  /** 0..1 mix volume. */
  volume: number;
  /** Excluded from playback and from the final render. */
  muted?: boolean;
  inSec?: number;
  outSec?: number;
}

export interface Timeline {
  clips: EditClip[];
  audio: EditAudioPlacement[];
  /** Mute the clips' native audio (e.g. keep only the music track). */
  muteVideo?: boolean;
}

/** A generated audio asset: scene voiceover (TTS) or a background music track. */
export interface AudioTrack {
  id: string;
  kind: "voice" | "music";
  /** For voiceovers: which scene the dialogue comes from. */
  sceneId?: string;
  label: string;
  prompt: string;
  url?: string;
  job?: Job;
  credits?: number;
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

/**
 * A reusable reference asset in the project's Library: a character, an
 * environment (location), a global visual style, or a product. Created via the
 * Magnific MCP (generate → save) and applied at generation for consistency.
 */
export interface LibraryAsset {
  id: string;
  type: "character" | "location" | "style" | "element" | "product";
  name: string;
  description?: string;
  /** Prompt used to generate the asset image (when created via MCP). */
  prompt?: string;
  /** Local thumbnail (downloaded; survives Magnific URL expiry). Cover = images[0]. */
  thumbnailUrl?: string;
  /** All reference images (local urls); [0] is the cover. Extra ones = sheet/grid views. */
  images?: string[];
  /** Magnific creation identifiers parallel to `images` (used to (re)build the library entry). */
  creationIds?: string[];
  /** Magnific library entry identifier — passed as-is in generation references. */
  magnificIdentifier?: string;
  /** Numeric Magnific library id (needed to EDIT the entry instead of re-creating). */
  magnificLibraryId?: number;
  /** In-flight generation job while the asset image is being produced. */
  job?: Job;
  /** In-flight job for the character sheet / environment 3×3 grid. */
  sheetJob?: Job;
  createdAt?: number;
}

export interface Settings {
  /** User's Anthropic API key. Kept only in memory in the MVP. Never hardcoded. */
  anthropicApiKey: string;
  /** Default model for director tasks (configurable). */
  directorModel: string;
  /** Which API drives the Director ("anthropic" by default). */
  directorProvider?: "anthropic" | "openai";
  /** User's OpenAI API key (browser-only, like the Anthropic one). */
  openaiApiKey?: string;
  openaiModel?: string;
  /** User's Magnific Business REST API key. In memory only; never exported. */
  magnificApiKey: string;
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
  /** Generated audio: per-scene voiceovers and background music. */
  audio?: AudioTrack[];
  /** Timeline montage (clip order/trim + audio placement) for the editor. */
  edit?: Timeline;
  consumption: Consumption;
  library: LibraryAsset[];
  /** Global visual style applied to every scene (a library "style" asset id). */
  styleId?: string;
  settings: Settings;
  gates: Gates;
  /** Realtime collaboration (Fase 0.5): set when this project is shared. */
  share?: { roomId: string; ownerUid: string; linkToken?: string };
}
