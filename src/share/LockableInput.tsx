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
      readOnly={!!lock.lockedBy}
      disabled={props.disabled || !!lock.lockedBy}
      onChange={lock.lockedBy ? undefined : props.onChange}
      title={lock.lockedBy ? `Editando: ${lock.lockedBy}` : props.title}
      onFocus={(e) => {
        if (lock.lockedBy) {
          // Held by a collaborator: refuse focus, never contest the lock.
          e.currentTarget.blur();
          return;
        }
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
