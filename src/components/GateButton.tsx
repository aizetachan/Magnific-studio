import { IconCheck, IconLock } from "@tabler/icons-react";
import type { GateState } from "@/types/project";

/** The explicit human approval that unlocks the next phase (§0.3). */
export function GateButton({
  state,
  label,
  onValidate,
  pending,
}: {
  state: GateState;
  label: string;
  onValidate: () => void;
  /** Items still pending before this gate can be validated (shown when disabled). */
  pending?: number;
}) {
  const disabled = state !== "ready";
  const content =
    state === "validated" ? (
      <>
        <IconCheck size={16} /> Validado
      </>
    ) : state === "locked" ? (
      <>
        <IconLock size={16} /> Bloqueado
      </>
    ) : state === "in_progress" && pending && pending > 0 ? (
      <>
        {label} · {pending} pendiente{pending > 1 ? "s" : ""}
      </>
    ) : (
      label
    );
  return (
    <button
      className={`gate gate--${state}`}
      disabled={disabled}
      onClick={onValidate}
    >
      {content}
    </button>
  );
}
