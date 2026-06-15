import type { ModelOption } from "@/generation/models";

/**
 * Inline model selector for a generation step. Shows friendly model names; the
 * selected value is the Magnific model slug stored on the shot (e.g. "auto",
 * "recraft-v4-1"). Recommended models are marked.
 */
export function ModelSelect({
  models,
  value,
  onChange,
  disabled,
  title,
}: {
  models: ModelOption[];
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  // If the stored slug isn't in the catalog (e.g. legacy default), keep it
  // selectable so the value is never silently lost.
  const hasValue = models.some((m) => m.slug === value);
  return (
    <select
      className="model-select"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
    >
      {!hasValue ? <option value={value}>{value}</option> : null}
      {models.map((m) => (
        <option key={m.slug} value={m.slug}>
          {m.recommended ? `${m.name} · recomendado` : m.name}
        </option>
      ))}
    </select>
  );
}
