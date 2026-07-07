import { useEffect, type ReactNode } from "react";

/**
 * Small confirmation modal (same backdrop/panel as the detail modal). Used to
 * warn before destructive actions like regenerating the story (which overwrites
 * the current page: idea, tone, style, actors, environments and arcs).
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Continuar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="detail-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="detail-modal__panel confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-modal__title">{title}</h3>
        <div className="confirm-modal__msg">{message}</div>
        <div className="confirm-modal__actions">
          <button className="action" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="action action--gen" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
