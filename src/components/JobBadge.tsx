import type { Job } from "@/types/project";

const LABEL: Record<string, string> = {
  idle: "—",
  queued: "En cola",
  rendering: "Generando",
  ready: "Listo",
  failed: "Fallido",
};

/** Visible async job state + which transport/mode produced it (transparency). */
export function JobBadge({ job }: { job?: Job }) {
  if (!job) return <span className="badge badge--idle">Sin generar</span>;
  return (
    <span className={`badge badge--${job.status}`} title={job.transportLabel}>
      {LABEL[job.status]}
      {job.status === "rendering" ? ` · ${job.progress}%` : ""}
      {job.status === "ready" && job.creditsCharged != null
        ? ` · ${job.creditsCharged} cr`
        : ""}
      {job.transportLabel !== "—" ? ` · ${job.mode}` : ""}
    </span>
  );
}
