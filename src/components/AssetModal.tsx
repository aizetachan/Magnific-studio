import { useEffect } from "react";

export interface PreviewAsset {
  url: string;
  kind: "image" | "video";
}

/**
 * Fullscreen preview for a generated asset: an image at full size or a video
 * with playback controls. Closes on backdrop click, the × button, or Escape.
 */
export function AssetModal({
  url,
  kind,
  onClose,
}: PreviewAsset & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="asset-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="asset-modal__x" aria-label="Cerrar" onClick={onClose}>
        ×
      </button>
      <div className="asset-modal__body" onClick={(e) => e.stopPropagation()}>
        {kind === "video" ? (
          <video className="asset-modal__media" src={url} controls autoPlay />
        ) : (
          <img className="asset-modal__media" src={url} alt="Vista previa" />
        )}
      </div>
    </div>
  );
}
