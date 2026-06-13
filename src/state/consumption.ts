import type { PhaseId, Project } from "@/types/project";

export interface ConsumptionTotals {
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeCostUsd: number;
  magnificCredits: number;
}

export function totals(project: Project): ConsumptionTotals {
  return project.consumption.events.reduce<ConsumptionTotals>(
    (acc, e) => {
      acc.claudeInputTokens += e.inputTokens ?? 0;
      acc.claudeOutputTokens += e.outputTokens ?? 0;
      acc.claudeCostUsd += e.claudeCostUsd ?? 0;
      acc.magnificCredits += e.credits ?? 0;
      return acc;
    },
    {
      claudeInputTokens: 0,
      claudeOutputTokens: 0,
      claudeCostUsd: 0,
      magnificCredits: 0,
    },
  );
}

/** Credits grouped by phase, for the per-phase history (§5.3). */
export function creditsByPhase(project: Project): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of project.consumption.events) {
    if (e.credits) out[e.phase] = (out[e.phase] ?? 0) + e.credits;
  }
  return out;
}

export const PHASE_LABELS: Record<PhaseId | "settings", string> = {
  story: "Historia",
  script: "Guion",
  storyboard: "Storyboard",
  production: "Producción",
  delivery: "Entrega",
  settings: "Ajustes",
};
