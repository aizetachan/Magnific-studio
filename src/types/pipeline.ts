/**
 * The pipeline contract.
 *
 * Each phase of Studio is a decoupled Block that implements PipelineBlock.
 * Blocks communicate ONLY via produce() -> consume() with typed contracts;
 * they never read another block's internal state. A future team can enhance or
 * replace a single block by re-implementing this interface, without touching
 * the rest of the pipeline.
 */

import type { ReactNode } from "react";
import type { GateState, PhaseId } from "./project";

/**
 * The scope a page injects into Claude on EVERY request. Claude has no memory
 * between calls, so the full scope must travel with each request. This is the
 * most important behavior in the app: page-context awareness.
 *
 *   scope = { fase, objetos_visibles, acciones_permitidas, referente_implícito }
 */
export interface PageContext {
  /** fase */
  phase: PhaseId;
  phaseLabel: string;
  /** objetos_visibles — what Claude can "see" in this page right now. */
  visibleObjects: Record<string, unknown>;
  /** acciones_permitidas — actions Claude may take in this phase. */
  allowedActions: string[];
  /** acciones bloqueadas — actions Claude must softly redirect away from. */
  blockedActions: string[];
  /**
   * referente_implícito — what "this" / "el plano 2" resolves to in this view.
   * e.g. "los planos de la Escena 3". Makes implicit references unambiguous.
   */
  implicitReferent: string;
}

/** A contextual action surfaced as a smart button and/or a Claude command. */
export interface BlockAction {
  id: string;
  label: string;
  /** Short description shown in tooltips / the director panel. */
  hint?: string;
  /** Whether the action triggers a generation (shows credit preflight). */
  generative?: boolean;
  /** Whether the action is currently enabled given block state. */
  enabled: boolean;
  run: (arg?: ActionArg) => void | Promise<void>;
}

/** Optional argument passed to an action (e.g. the resolved implicit referent). */
export interface ActionArg {
  shotId?: string;
  sceneId?: string;
  prompt?: string;
  freeText?: string;
}

/** Typed handoff between phases. Each block declares what it consumes/produces. */
export interface BlockInput {
  from: PhaseId | null;
  payload: unknown;
}

export interface BlockOutput {
  phase: PhaseId;
  payload: unknown;
}

export interface PipelineBlock {
  id: PhaseId;
  label: string;
  icon: string;

  /** Context this block injects into Claude when active. */
  getPageContext(): PageContext;

  /** Actions this block exposes (contextual buttons + Claude commands). */
  getActions(): BlockAction[];

  /** Input received from the previous validated phase. */
  consume(input: BlockInput): void;

  /** Output produced toward the next phase (when the gate passes). */
  produce(): BlockOutput;

  /** Validation gate state. */
  getGateState(): GateState;
  validate(): void;

  /** UI of the page. */
  render(): ReactNode;
}
