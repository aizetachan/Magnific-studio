import type { InputHTMLAttributes } from "react";
import { useFieldLock } from "./locks";

/** Input with collaborative field locking (see LockableTextarea). */
export function LockableInput({
  lockPath,
  ...props
}: { lockPath: string } & InputHTMLAttributes<HTMLInputElement>) {
  const lock = useFieldLock(lockPath);
  return (
    <input
      {...props}
      className={`${props.className ?? ""} ${lock.lockedBy ? "field-locked" : ""}`.trim()}
      disabled={props.disabled || !!lock.lockedBy}
      title={lock.lockedBy ? `Editando: ${lock.lockedBy}` : props.title}
      onFocus={(e) => {
        lock.onFocus();
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        lock.onBlur();
        props.onBlur?.(e);
      }}
    />
  );
}
