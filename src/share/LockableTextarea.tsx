import type { TextareaHTMLAttributes } from "react";
import { useFieldLock } from "./locks";

/**
 * Textarea with collaborative field locking: while a peer edits it, it renders
 * disabled with the editor's identity; focusing it claims the lock for you.
 * Outside a shared room it behaves exactly like a plain <textarea>.
 */
export function LockableTextarea({
  lockPath,
  ...props
}: { lockPath: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const lock = useFieldLock(lockPath);
  return (
    <textarea
      {...props}
      className={`${props.className ?? ""} ${lock.lockedBy ? "field-locked" : ""}`.trim()}
      readOnly={!!lock.lockedBy}
      disabled={props.disabled || !!lock.lockedBy}
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
