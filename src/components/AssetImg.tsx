import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadLocalBlob, loadProjectAssetBlob } from "@/state/assets";

/**
 * Image that survives dead blob: urls and unhydrated local: refs — walks a
 * candidate list on error, resolving local: refs straight from the project's
 * working folder / IndexedDB. Renders `fallback` while loading and when every
 * candidate fails (so the UI shows a placeholder instead of a broken image).
 */
export function AssetImg({
  candidates,
  projectId,
  alt,
  className,
  onClick,
  fallback = null,
}: {
  candidates: string[];
  projectId: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  fallback?: ReactNode;
}) {
  const [idx, setIdx] = useState(0);
  const [resolved, setResolved] = useState<string | null>(null);
  const list = useMemo(() => candidates.filter(Boolean), [candidates.join("|")]);

  useEffect(() => {
    setIdx(0);
    setResolved(null);
  }, [list.join("|")]);

  useEffect(() => {
    const cur = list[idx];
    if (!cur) return;
    if (!cur.startsWith("local:")) {
      setResolved(cur);
      return;
    }
    // Unhydrated ref: resolve straight from the project's local folder (the
    // same robust path the dashboard library uses).
    let alive = true;
    let url: string | null = null;
    void (async () => {
      const blob = (await loadLocalBlob(cur)) ?? (await loadProjectAssetBlob(projectId, cur.slice("local:".length)));
      if (!alive) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        setResolved(url);
      } else {
        setIdx((i) => i + 1);
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [list, idx, projectId]);

  if (!resolved) return <>{fallback}</>;
  return (
    <img
      className={className}
      src={resolved}
      alt={alt}
      onClick={onClick}
      onError={() => {
        setResolved(null);
        setIdx((i) => i + 1);
      }}
    />
  );
}
