import { useState } from "react";
import { IconAlertTriangle, IconTrash, IconX } from "@tabler/icons-react";
import { useI18n } from "@/i18n";

/**
 * Critical-delete confirmation: the destructive button stays disabled until
 * the user types the exact confirmation text (the file name, or a keyword
 * for bulk deletion). Deleting also removes local content — say it loudly.
 */
export function DeleteConfirmModal({
  title,
  body,
  prompt,
  expected,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  prompt: string;
  /** The exact text the user must type to arm the delete button. */
  expected: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const { t } = useI18n();
  const armed = typed.trim() === expected;

  return (
    <div className="detail-modal" role="alertdialog" aria-modal="true" onClick={onCancel}>
      <div className="detail-modal__panel confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-modal__title confirm-modal__title--danger">
          <IconAlertTriangle size={18} style={{ verticalAlign: "-3px" }} /> {title}
        </h3>
        <div className="confirm-modal__msg">
          <p>{body}</p>
          <p className="muted small">{prompt}</p>
          <input
            autoFocus
            value={typed}
            placeholder={expected}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && armed && onConfirm()}
          />
        </div>
        <div className="confirm-modal__actions">
          <button className="action" onClick={onCancel}>
            <IconX size={14} /> {t("alert.close")}
          </button>
          <button className="action action--danger" disabled={!armed} onClick={onConfirm}>
            <IconTrash size={14} /> {t("trash.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
