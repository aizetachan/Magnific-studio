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
