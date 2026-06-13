import type { GateState } from "@/types/project";

/** The explicit human approval that unlocks the next phase (§0.3). */
export function GateButton({
  state,
  label,
  onValidate,
}: {
  state: GateState;
  label: string;
  onValidate: () => void;
}) {
  const disabled = state === "locked" || state === "in_progress";
  const text =
    state === "validated"
      ? "✓ Validado"
      : state === "ready"
        ? label
        : state === "locked"
          ? "🔒 Bloqueado"
          : label;
  return (
    <button
      className={`gate gate--${state}`}
      disabled={disabled || state === "validated"}
      onClick={onValidate}
    >
      {text}
    </button>
  );
}
