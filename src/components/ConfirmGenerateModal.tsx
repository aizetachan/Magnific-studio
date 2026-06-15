import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { ModelSelect } from "./ModelSelect";
import { useModels, estCreditsFor } from "@/generation/models";
import { config } from "@/config";
import type { GenerationKind } from "@/types/generation";

/**
 * Confirmation before a batch ("Generar todo"): pick the model applied to ALL
 * items and confirm, or cancel. Avoids generating one by one.
 */
export function ConfirmGenerateModal({
  title,
  count,
  kind,
  onConfirm,
  onClose,
}: {
  title: string;
  count: number;
  kind: GenerationKind;
  onConfirm: (model: string) => void;
  onClose: () => void;
}) {
  const models = useModels(kind);
  const [model, setModel] = useState("auto");
  // Cost updates with the chosen model (different models cost differently).
  const estCredits = estCreditsFor(kind, model) * count;
  const estEur = (estCredits * config.magnificCreditEur).toFixed(2);

  return (
    <div className="asset-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal__head">
          <strong>{title}</strong>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>
        <p className="muted small">
          Se generarán <b>{count}</b> {count === 1 ? "elemento" : "elementos"} con
          el modelo elegido, en tandas para no saturar Magnific.
        </p>
        <ul className="meta-list" style={{ margin: "4px 0 12px" }}>
          <li>
            <span>Coste estimado</span>
            <b>
              ≈ {estCredits} cr · ≈ €{estEur}
            </b>
          </li>
        </ul>
        <label className="card__label">Modelo para todos</label>
        <ModelSelect models={models} value={model} onChange={setModel} />
        <div className="confirm-modal__actions">
          <button className="mini" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="gate gate--ready"
            disabled={count === 0}
            onClick={() => onConfirm(model)}
          >
            Generar {count}
          </button>
        </div>
      </div>
    </div>
  );
}
