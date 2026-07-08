import { useEffect, useState } from "react";
import type { Job } from "@/types/project";

const LABEL: Record<string, string> = {
  idle: "·",
  queued: "En cola",
  rendering: "Generando",
  ready: "Listo",
  failed: "Fallido",
};

/** Remaining time from the job's start vs. the model's expected duration. */
function useEta(job?: Job, etaSec?: number): number | null {
  const rendering = job?.status === "rendering" || job?.status === "queued";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rendering || !etaSec) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rendering, etaSec]);
  if (!rendering || !etaSec || !job?.createdAt) return null;
  const elapsed = (now - job.createdAt) / 1000;
  return Math.max(0, Math.round(etaSec - elapsed));
}

function fmtEta(sec: number): string {
  if (sec >= 60) return `~${Math.ceil(sec / 60)} min`;
  return `~${sec}s`;
}

/** Visible async job state (estado + progreso/créditos + ETA). */
export function JobBadge({ job, etaSec }: { job?: Job; etaSec?: number }) {
  const eta = useEta(job, etaSec);
  if (!job) return <span className="badge badge--idle">Sin generar</span>;
  return (
    <span
      className={`badge badge--${job.status}`}
      title={job.status === "failed" ? job.error : undefined}
    >
      {LABEL[job.status]}
      {job.status === "rendering" ? ` · ${job.progress}%` : ""}
      {(job.status === "rendering" || job.status === "queued") && eta != null
        ? ` · ${eta > 0 ? `${fmtEta(eta)} rest.` : "casi listo"}`
        : ""}
      {job.status === "ready" && job.creditsCharged != null
        ? ` · ${job.creditsCharged} cr`
        : ""}
    </span>
  );
}
