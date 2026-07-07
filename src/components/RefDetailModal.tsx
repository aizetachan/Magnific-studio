import { useEffect } from "react";
import { IconX } from "@tabler/icons-react";

export interface RefDetailProps {
  kindLabel: string; // "Personaje" | "Entorno"
  name: string;
  description: string;
  prompt: string;
  imageUrl?: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onPrompt: (v: string) => void;
  onClose: () => void;
}

/**
 * Compact detail modal for a character / environment reference: edit name and
 * description, and read the full prompt used for generation (shown larger). It
 * stays small (under half the screen) and never takes over the whole viewport.
 */
export function RefDetailModal({
  kindLabel,
  name,
  description,
  prompt,
  imageUrl,
  onName,
  onDescription,
  onPrompt,
  onClose,
}: RefDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="detail-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="detail-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-modal__head">
          <span className="detail-modal__tag">{kindLabel}</span>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        {imageUrl ? (
          <img className="detail-modal__img" src={imageUrl} alt={name} />
        ) : null}

        <label className="card__label">Nombre</label>
        <input value={name} onChange={(e) => onName(e.target.value)} />

        <label className="card__label">Descripción</label>
        <textarea
          value={description}
          placeholder="Descripción"
          onChange={(e) => onDescription(e.target.value)}
        />

        <label className="card__label">Prompt usado</label>
        <textarea
          className="detail-modal__prompt"
          value={prompt}
          placeholder="Prompt de generación de la imagen"
          onChange={(e) => onPrompt(e.target.value)}
        />
        <p className="muted small">
          Editar el prompt lo fija manualmente; si luego cambias el nombre o la
          descripción, se regenerará.
        </p>
      </div>
    </div>
  );
}
