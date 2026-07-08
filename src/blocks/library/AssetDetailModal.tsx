import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrush,
  IconCheck,
  IconInfoCircle,
  IconLayoutGrid,
  IconPhotoUp,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import type { Job, LibraryAsset } from "@/types/project";
import { useStore } from "@/state/ProjectStore";
import { config } from "@/config";
import { loadLocalBlob, loadProjectAssetBlob, storeAssetBlob } from "@/state/assets";

/**
 * Asset detail modal — EVERYTHING about a library asset happens here:
 * big principal image (the one generation uses), up to 5 more reference
 * slots (6 total = the Magnific Library cap), prompt box to generate new
 * images / edit the principal, own-image upload, character sheet fill,
 * collapsible Director description, rename and delete. Any change to the
 * image set re-registers the Magnific Library entry AUTOMATICALLY.
 */

const MAX_IMAGES = 6;

const MCP_TYPE: Record<"character" | "location", "character" | "locations"> = {
  character: "character",
  location: "locations",
};

function jobAt(status: Job["status"], patch: Partial<Job> = {}): Job {
  const now = Date.now();
  return {
    id: `job_${now}`,
    kind: "image",
    status,
    mode: "mcp_default",
    transportLabel: "McpTransport",
    progress: status === "ready" ? 100 : 5,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

/** Image that survives dead blob: urls — walks a candidate list on error. */
export function AssetImg({
  candidates,
  projectId,
  alt,
  className,
  onClick,
}: {
  candidates: string[];
  projectId: string;
  alt: string;
  className?: string;
  onClick?: () => void;
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

  if (!resolved) return null;
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

export function AssetDetailModal({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { project, update, generation } = useStore();
  const asset = (project.library ?? []).find((a) => a.id === assetId);
  const [promptText, setPromptText] = useState(asset?.prompt ?? "");
  const [showDesc, setShowDesc] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Freshest project inside async flows (state advances while jobs run).
  const storeRef = useRef(project);
  storeRef.current = project;

  if (!asset) return null;
  const isStyle = asset.type === "style";
  const images = asset.images ?? (asset.thumbnailUrl ? [asset.thumbnailUrl] : []);
  const creations = asset.creationIds ?? [];
  const free = Math.max(0, MAX_IMAGES - images.length);
  const running = asset.job?.status === "queued" || asset.job?.status === "rendering";

  const mutate = (fn: (a: LibraryAsset) => void) =>
    update((d) => {
      const a = d.library?.find((x) => x.id === assetId);
      if (a) fn(a);
    });

  /** AUTOMATIC Magnific registration: edit the existing entry when we have
   * its numeric id, create it otherwise. Fire-and-forget; style is local. */
  const syncMagnific = async () => {
    const a = storeRef.current.library?.find((x) => x.id === assetId) ?? asset;
    if (a.type === "style") return;
    const ids = (a.creationIds ?? []).filter(Boolean).slice(0, MAX_IMAGES);
    if (ids.length === 0) return;
    const imagesPayload = ids.map((creationIdentifier) => ({ creationIdentifier }));
    try {
      if (a.magnificLibraryId) {
        await fetch(`${config.directorBase}/library-edit`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: a.magnificLibraryId, images: imagesPayload }),
        });
      } else {
        const res = await fetch(`${config.directorBase}/library-create`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: a.name,
            type: MCP_TYPE[a.type as "character" | "location"],
            description: a.description || a.prompt || undefined,
            images: imagesPayload,
          }),
        });
        const data = (await res.json()) as { ok: boolean; identifier?: string; id?: number; needsMagnific?: boolean };
        if (data.ok && data.identifier) {
          mutate((x) => {
            x.magnificIdentifier = String(data.identifier);
            if (data.id != null) x.magnificLibraryId = Number(data.id);
          });
        } else if (data.needsMagnific) {
          setNote("Conecta Magnific en Ajustes para usar estas imágenes como referencia en generaciones.");
        }
      }
    } catch {
      /* registration retries on the next change */
    }
  };


  const track = (label: string, p: string) =>
    generation.generate(
      {
        kind: "image",
        prompt: p,
        model: "auto",
        assetHint: `biblioteca_${asset.name}_${label}`,
        libraryRefs:
          !isStyle && asset.magnificIdentifier
            ? [{ type: asset.type === "location" ? ("locations" as const) : ("character" as const), identifier: asset.magnificIdentifier }]
            : undefined,
      },
      ({ progress, status }) => {
        mutate((a) => {
          const j = a.job;
          if (!j || j.status === "ready" || j.status === "failed") return;
          j.status = status === "ready" ? "rendering" : status;
          j.progress = Math.max(j.progress, Math.min(99, progress));
          j.updatedAt = Date.now();
        });
      },
    );

  /** Generate a NEW image into the next free slot. */
  const generateNew = async () => {
    const p = (isStyle ? asset.prompt ?? "" : promptText).trim();
    if (!p || running) return;
    if (free === 0) {
      setNote("Ya tienes 6 imágenes (máximo). Elimina o sustituye alguna.");
      return;
    }
    setBusy("gen");
    mutate((a) => {
      a.prompt = p;
      a.job = jobAt("queued");
    });
    try {
      const result = await track("nueva", p);
      mutate((a) => {
        a.job = jobAt(result.ok ? "ready" : "failed", {
          progress: 100,
          resultUrl: result.resultUrl,
          taskId: result.taskId,
          error: result.error,
          creditsCharged: result.creditsCharged,
        });
        if (result.ok && result.resultUrl) {
          a.images = [...(a.images ?? (a.thumbnailUrl ? [a.thumbnailUrl] : []))];
          a.creationIds = [...(a.creationIds ?? [])];
          a.images.push(result.resultUrl);
          a.creationIds.push(result.taskId ?? "");
          if (!a.thumbnailUrl) a.thumbnailUrl = result.resultUrl;
        }
      });
      if (result.ok) void syncMagnific();
    } catch (e) {
      mutate((a) => {
        a.job = jobAt("failed", { error: e instanceof Error ? e.message : String(e) });
      });
    } finally {
      setBusy(null);
    }
  };

  /** Edit the PRINCIPAL: img2img variation that REPLACES it (no new slot). */
  const editPrincipal = async () => {
    const p = (isStyle ? asset.prompt ?? "" : promptText).trim();
    if (!p || running) return;
    const refCreation = creations[0];
    if (!images[0]) {
      setNote("No hay imagen principal que editar todavía. Genera o carga una.");
      return;
    }
    setBusy("edit");
    mutate((a) => {
      a.job = jobAt("queued");
    });
    try {
      const result = await generation.generate(
        {
          kind: "image",
          prompt: p,
          model: "auto",
          assetHint: `biblioteca_${asset.name}_edit`,
          references: refCreation ? [refCreation] : undefined,
        },
        ({ progress, status }) => {
          mutate((a) => {
            const j = a.job;
            if (!j || j.status === "ready" || j.status === "failed") return;
            j.status = status === "ready" ? "rendering" : status;
            j.progress = Math.max(j.progress, Math.min(99, progress));
          });
        },
      );
      mutate((a) => {
        a.job = jobAt(result.ok ? "ready" : "failed", {
          progress: 100,
          resultUrl: result.resultUrl,
          taskId: result.taskId,
          error: result.error,
          creditsCharged: result.creditsCharged,
        });
        if (result.ok && result.resultUrl) {
          a.images = [...(a.images ?? [])];
          a.creationIds = [...(a.creationIds ?? [])];
          a.images[0] = result.resultUrl;
          a.creationIds[0] = result.taskId ?? "";
          a.thumbnailUrl = result.resultUrl;
        }
      });
      if (result.ok) void syncMagnific();
    } catch (e) {
      mutate((a) => {
        a.job = jobAt("failed", { error: e instanceof Error ? e.message : String(e) });
      });
    } finally {
      setBusy(null);
    }
  };

  /** Character sheet: keep generating poses until all 6 slots are full. */
  const fillSheet = async () => {
    if (running || free === 0) return;
    setBusy("sheet");
    const base = asset.prompt || promptText.trim() || asset.name;
    const poses = [
      "vista de cuerpo entero, pose neutra",
      "plano medio, tres cuartos",
      "perfil lateral",
      "vista trasera",
      "primer plano del rostro",
      "pose de acción expresiva",
    ];
    try {
      for (let slot = images.length; slot < MAX_IMAGES; slot++) {
        mutate((a) => {
          a.job = jobAt("queued");
        });
        const p = `${base}. ${isStyle ? "variación del estilo" : poses[slot % poses.length]}, mismo ${asset.type === "location" ? "entorno" : "personaje"}, consistencia total`;
        const result = await track(`pose${slot}`, p);
        mutate((a) => {
          a.job = jobAt(result.ok ? "ready" : "failed", {
            progress: 100,
            resultUrl: result.resultUrl,
            taskId: result.taskId,
            error: result.error,
            creditsCharged: result.creditsCharged,
          });
          if (result.ok && result.resultUrl) {
            a.images = [...(a.images ?? [])];
            a.creationIds = [...(a.creationIds ?? [])];
            a.images.push(result.resultUrl);
            a.creationIds.push(result.taskId ?? "");
            if (!a.thumbnailUrl) a.thumbnailUrl = result.resultUrl;
          }
        });
        if (!result.ok) break;
      }
      void syncMagnific();
    } finally {
      setBusy(null);
    }
  };

  /** Upload your own image: becomes the principal; the previous principal
   * moves to a free slot (or is replaced when full). */
  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy("upload");
    setNote(null);
    try {
      const localUrl = await storeAssetBlob(`ref_${assetId}_${Date.now()}`, file, ".png");
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("No se pudo leer el archivo"));
        r.readAsDataURL(file);
      });
      let creationId = "";
      if (!isStyle) {
        const mime = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : "image/png";
        const up = await fetch(`${config.directorBase}/upload-creation`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ base64: b64, mime }),
        });
        const upData = (await up.json()) as { ok: boolean; identifier?: string; needsMagnific?: boolean; error?: string };
        if (upData.ok && upData.identifier) creationId = upData.identifier;
        else if (upData.needsMagnific)
          setNote("Imagen guardada en local. Conecta Magnific en Ajustes para usarla como referencia en generaciones.");
        else if (upData.error) throw new Error(upData.error);
      }
      mutate((a) => {
        const imgs = [...(a.images ?? (a.thumbnailUrl ? [a.thumbnailUrl] : []))];
        const cids = [...(a.creationIds ?? [])];
        const prevPrincipal = imgs[0];
        const prevCid = cids[0];
        imgs[0] = localUrl;
        cids[0] = creationId;
        if (prevPrincipal) {
          if (imgs.length < MAX_IMAGES) {
            imgs.push(prevPrincipal);
            cids.push(prevCid ?? "");
          }
        }
        a.images = imgs.slice(0, MAX_IMAGES);
        a.creationIds = cids.slice(0, MAX_IMAGES);
        a.thumbnailUrl = localUrl;
      });
      if (creationId) void syncMagnific();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Promote a mini to principal (swap; the set itself doesn't change). */
  const promote = (i: number) => {
    if (i === 0) return;
    mutate((a) => {
      const imgs = [...(a.images ?? [])];
      const cids = [...(a.creationIds ?? [])];
      [imgs[0], imgs[i]] = [imgs[i], imgs[0]];
      [cids[0], cids[i]] = [cids[i] ?? "", cids[0] ?? ""];
      a.images = imgs;
      a.creationIds = cids;
      a.thumbnailUrl = imgs[0];
    });
    void syncMagnific();
  };

  const removeAsset = () => {
    update((d) => {
      d.library = (d.library ?? []).filter((x) => x.id !== assetId);
      if (d.styleId === assetId) d.styleId = undefined;
      for (const s of d.scenes) {
        if (s.locationId === assetId) s.locationId = undefined;
        if (s.characterIds) s.characterIds = s.characterIds.filter((c) => c !== assetId);
      }
    });
    onClose();
  };

  const styleActive = isStyle && project.styleId === assetId;

  return (
    <div className="detail-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="detail-modal__panel amodal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            void onUpload(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        {/* Header */}
        <div className="amodal__head">
          <input
            className="amodal__name"
            value={asset.name}
            onChange={(e) => mutate((a) => (a.name = e.target.value))}
          />
          <button
            className={`icon-btn ${showDesc ? "is-on" : ""}`}
            title="Descripción (la usa el Director)"
            onClick={() => setShowDesc((v) => !v)}
          >
            <IconInfoCircle size={16} />
          </button>
          {confirmDelete ? (
            <span className="amodal__confirm">
              ¿Eliminar?
              <button className="action action--danger" onClick={removeAsset}>Sí</button>
              <button className="action" onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          ) : (
            <button className="icon-btn" title="Eliminar" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={16} />
            </button>
          )}
          <button className="icon-btn" title="Cerrar" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        {/* Principal image */}
        <div className="amodal__main">
          {images[0] ? (
            <AssetImg candidates={[images[0], asset.thumbnailUrl ?? ""]} projectId={project.id} alt={asset.name} className="amodal__mainimg" />
          ) : (
            <div className="amodal__placeholder">sin imagen</div>
          )}
          {running ? (
            <div className="queue amodal__queue">
              <div className="queue__bar" style={{ width: `${asset.job?.progress ?? 5}%` }} />
            </div>
          ) : null}
        </div>

        {/* Slots row: minis + free holes */}
        <div className="amodal__slots">
          {images.slice(1).map((img, i) => (
            <button className="amodal__slot" key={`${i}_${img.slice(-18)}`} title="Usar como principal" onClick={() => promote(i + 1)}>
              <AssetImg candidates={[img]} projectId={project.id} alt="" className="amodal__slotimg" />
            </button>
          ))}
          {Array.from({ length: free && images.length ? free : Math.max(0, MAX_IMAGES - Math.max(images.length, 1)) }).map((_, i) => (
            <div className="amodal__slot amodal__slot--free" key={`free_${i}`} title="Hueco libre: las nuevas generaciones aparecen aquí">
              +
            </div>
          ))}
        </div>

        {/* Prompt + actions. For STYLE assets the definition below IS the
            prompt (one single source), so the extra box is hidden. */}
        {!isStyle ? (
          <textarea
            className="amodal__prompt"
            placeholder="Describe qué generar o cómo editar la principal…"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
        ) : null}
        <div className="amodal__actions">
          <button className="action action--primary" disabled={!!busy || running || free === 0} onClick={() => void generateNew()}>
            <IconSparkles size={15} /> {busy === "gen" ? "Generando…" : "Generar"}
          </button>
          <button className="action" disabled={!!busy || running || !images[0]} onClick={() => void editPrincipal()}>
            <IconBrush size={15} /> {busy === "edit" ? "Editando…" : "Editar esta"}
          </button>
          <button className="icon-btn" title="Cargar imagen propia" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <IconPhotoUp size={17} />
          </button>
          {!isStyle ? (
            <button className="action" disabled={!!busy || running || free === 0} onClick={() => void fillSheet()}>
              <IconLayoutGrid size={15} />{" "}
              {busy === "sheet" ? "Generando poses…" : asset.type === "location" ? "Completar vistas" : "Hoja de personaje"}
            </button>
          ) : null}
          <span className="amodal__count muted small">{images.length}/{MAX_IMAGES}</span>
          {!isStyle && asset.magnificIdentifier ? (
            <span className="asset-card__ok"><IconCheck size={13} /> en biblioteca</span>
          ) : null}
        </div>
        {asset.job?.status === "failed" && asset.job.error ? (
          <p className="muted small" style={{ color: "var(--err, #d05656)" }}>{asset.job.error}</p>
        ) : null}
        {note ? <p className="muted small">{note}</p> : null}

        {/* Style: definition text + activate */}
        {isStyle ? (
          <div className="amodal__style">
            <label className="card__label">Definición del estilo (se aplica a TODAS las generaciones; Generar crea una imagen de referencia a partir de ella)</label>
            <textarea
              className="kf__prompt"
              value={asset.prompt ?? ""}
              onChange={(e) => mutate((a) => (a.prompt = e.target.value))}
            />
            <button className={`action ${styleActive ? "is-on" : "action--primary"}`} onClick={() => update((d) => { d.styleId = styleActive ? undefined : assetId; })}>
              {styleActive ? (<><IconCheck size={14} /> Estilo activo</>) : "Usar como estilo global"}
            </button>
          </div>
        ) : null}

        {/* Collapsible Director description */}
        {showDesc && !isStyle ? (
          <div className="amodal__desc">
            <label className="card__label">Descripción (la usa el Director)</label>
            <textarea
              className="kf__prompt"
              value={asset.description ?? ""}
              onChange={(e) => mutate((a) => (a.description = e.target.value))}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
