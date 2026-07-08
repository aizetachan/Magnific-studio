import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconRefresh,
  IconTrash,
  IconDownload,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { JobBadge } from "@/components/JobBadge";
import { ModelSelect } from "@/components/ModelSelect";
import { AssetModal, type PreviewAsset } from "@/components/AssetModal";
import { useModels } from "@/generation/models";
import { config } from "@/config";
import { uid } from "@/state/seed";
import { generateAssetSheet } from "../runner";
import type { Job } from "@/types/project";
import { showAppAlert } from "@/components/AppAlert";

/**
 * Library — reusable reference assets for visual consistency. Characters and
 * environments (locations) are generated with the MCP and saved to the Magnific
 * Library; the global style is a text definition applied to every scene's
 * keyframes. Created BEFORE storyboard/production.
 */

type Tab = "character" | "location" | "style";
const TAB_LABEL: Record<Tab, string> = {
  character: "Personajes",
  location: "Entornos",
  style: "Estilo",
};
// Internal type -> Magnific library_create / reference type.
const MCP_TYPE: Record<"character" | "location", string> = {
  character: "character",
  location: "locations",
};

function jobAt(status: Job["status"], patch: Partial<Job> = {}): Job {
  const now = Date.now();
  return {
    id: patch.id ?? `asset_${now}`,
    kind: "image",
    status,
    mode: "mcp_default",
    transportLabel: "McpTransport",
    progress: patch.progress ?? (status === "ready" ? 100 : 5),
    createdAt: patch.createdAt ?? now,
    updatedAt: now,
    ...patch,
  };
}

export function LibraryPage({ focusAssetId }: { focusAssetId?: string | null }) {
  const store = useStore();
  const { project, update, generation } = store;
  const [tab, setTab] = useState<Tab>("character");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  // Deep-link focus: switch to the asset's tab and highlight/scroll to it.
  useEffect(() => {
    if (!focusAssetId) return;
    const a = (project.library ?? []).find((x) => x.id === focusAssetId);
    if (!a) return;
    setTab(a.type === "location" ? "location" : a.type === "style" ? "style" : "character");
    setHighlight(focusAssetId);
    const t = setTimeout(() => focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    const clear = setTimeout(() => setHighlight(null), 2400);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
    // Only re-run when the focus target changes — NOT on every project change
    // (project.library changes on each autosave/job, which kept re-highlighting).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAssetId]);
  const imageModels = useModels("image");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("auto");
  const [syncing, setSyncing] = useState(false);
  const [importable, setImportable] = useState<
    { identifier: string; name: string; thumbnail?: string }[] | null
  >(null);

  const assets = (project.library ?? []).filter((a) => a.type === tab);

  /** Generate the asset image with the MCP into a draft library asset. */
  const runAsset = async (id: string, p: string, m: string) => {
    update((d) => {
      const a = d.library?.find((x) => x.id === id);
      if (a) a.job = jobAt("queued");
    });
    try {
      const result = await generation.generate(
        { kind: "image", prompt: p, model: m },
        ({ progress, status }) => {
          update((d) => {
            const j = d.library?.find((x) => x.id === id)?.job;
            if (!j || j.status === "ready" || j.status === "failed") return;
            j.status = status === "ready" ? "rendering" : status;
            j.progress = Math.max(j.progress, Math.min(99, progress));
            j.updatedAt = Date.now();
          });
        },
      );
      update((d) => {
        const a = d.library?.find((x) => x.id === id);
        if (!a) return;
        a.job = jobAt(result.ok ? "ready" : "failed", {
          progress: 100,
          resultUrl: result.resultUrl,
          taskId: result.taskId,
          error: result.error,
          creditsCharged: result.creditsCharged,
        });
        if (result.ok && result.resultUrl) a.thumbnailUrl = result.resultUrl;
      });
    } catch (e) {
      update((d) => {
        const a = d.library?.find((x) => x.id === id);
        if (a) a.job = jobAt("failed", { error: e instanceof Error ? e.message : String(e) });
      });
    }
  };

  const generate = () => {
    if (!prompt.trim()) return;
    const id = uid("asset");
    const assetName = name.trim() || `${TAB_LABEL[tab].replace(/s$/, "")} ${assets.length + 1}`;
    update((d) => {
      d.library = d.library ?? [];
      d.library.push({ id, type: tab, name: assetName, prompt, createdAt: Date.now() });
    });
    setName("");
    setPrompt("");
    if (tab !== "style") void runAsset(id, prompt, model);
  };

  /** Promote a generated character/location to the Magnific Library (reusable ref). */
  const saveToLibrary = async (assetId: string) => {
    const a = project.library?.find((x) => x.id === assetId);
    if (!a || a.type === "style") return;
    const creationId = a.job?.taskId;
    if (!creationId) return;
    try {
      const res = await fetch(`${config.directorBase}/library-create`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: a.name,
          type: MCP_TYPE[a.type as "character" | "location"],
          description: a.prompt || undefined,
          images: [{ creationIdentifier: creationId }],
        }),
      });
      const data = (await res.json()) as { ok: boolean; identifier?: string; error?: string };
      if (!data.ok || !data.identifier) throw new Error(data.error ?? "No se pudo guardar");
      update((d) => {
        const x = d.library?.find((y) => y.id === assetId);
        if (x) x.magnificIdentifier = String(data.identifier);
      });
    } catch (e) {
      showAppAlert(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (assetId: string) =>
    update((d) => {
      d.library = (d.library ?? []).filter((x) => x.id !== assetId);
      if (d.styleId === assetId) d.styleId = undefined;
      for (const s of d.scenes) {
        if (s.locationId === assetId) s.locationId = undefined;
        if (s.characterIds) s.characterIds = s.characterIds.filter((c) => c !== assetId);
      }
    });

  const rename = (assetId: string, value: string) =>
    update((d) => {
      const x = d.library?.find((y) => y.id === assetId);
      if (x) x.name = value;
    });

  const setStyleText = (assetId: string, value: string) =>
    update((d) => {
      const x = d.library?.find((y) => y.id === assetId);
      if (x) x.prompt = value;
    });

  const useAsStyle = (assetId: string) =>
    update((d) => {
      d.styleId = d.styleId === assetId ? undefined : assetId;
    });

  /** Pull existing assets from the user's Magnific account to reuse them. */
  const sync = async () => {
    if (tab === "style") return;
    setSyncing(true);
    setImportable(null);
    try {
      const res = await fetch(
        `${config.directorBase}/library-list?type=${MCP_TYPE[tab]}`,
        { credentials: "include" },
      );
      const data = (await res.json()) as {
        ok: boolean;
        assets?: { identifier: string; name: string; thumbnail?: string }[];
      };
      const have = new Set((project.library ?? []).map((a) => a.magnificIdentifier).filter(Boolean));
      setImportable((data.assets ?? []).filter((a) => !have.has(a.identifier)));
    } catch {
      setImportable([]);
    } finally {
      setSyncing(false);
    }
  };

  const importAsset = (entry: { identifier: string; name: string; thumbnail?: string }) => {
    update((d) => {
      d.library = d.library ?? [];
      d.library.push({
        id: uid("asset"),
        type: tab === "style" ? "style" : (tab as "character" | "location"),
        name: entry.name,
        magnificIdentifier: entry.identifier,
        thumbnailUrl: entry.thumbnail,
        createdAt: Date.now(),
      });
    });
    setImportable((list) => (list ?? []).filter((x) => x.identifier !== entry.identifier));
  };

  return (
    <div className="page">
      <div className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "tab--on" : ""}`}
            onClick={() => {
              setTab(t);
              setImportable(null);
            }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Create */}
      <section className="cards">
        <div className="card">
          <label className="card__label">
            {tab === "style" ? "Definir estilo visual" : `Nuevo ${TAB_LABEL[tab].replace(/s$/, "").toLowerCase()}`}
          </label>
          <input
            className="char-lib__url"
            placeholder={tab === "style" ? "Nombre del estilo (p. ej. Acuarela cálida)" : "Nombre"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <textarea
            className="kf__prompt"
            placeholder={
              tab === "character"
                ? "Describe el personaje (rasgos, vestuario, edad…)"
                : tab === "location"
                  ? "Describe el entorno (lugar, luz, atmósfera…)"
                  : "Define el estilo visual que tendrán TODAS las escenas (técnica, paleta, grano, referencias…)"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="kf__row muted small" style={{ marginTop: 8 }}>
            {tab !== "style" ? (
              <ModelSelect models={imageModels} value={model} onChange={setModel} />
            ) : (
              <span>Se aplica como definición de estilo a los keyframes.</span>
            )}
          </div>
          <div className="kf__actions">
            <button className="action action--gen" disabled={!prompt.trim()} onClick={generate}>
              {tab === "style" ? "Añadir estilo" : "Generar"}
            </button>
            {tab !== "style" ? (
              <button className="mini" disabled={syncing} onClick={sync}>
                <IconDownload size={14} /> Sincronizar con mi cuenta
              </button>
            ) : null}
          </div>

          {importable && importable.length > 0 ? (
            <div className="music-list" style={{ marginTop: 10 }}>
              <span className="muted small">En tu cuenta de Magnific:</span>
              {importable.map((e) => (
                <div className="music-item" key={e.identifier}>
                  {e.thumbnail ? (
                    <img src={e.thumbnail} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
                  ) : null}
                  <span className="music-item__name">{e.name}</span>
                  <button className="mini" onClick={() => importAsset(e)}>Añadir</button>
                </div>
              ))}
            </div>
          ) : importable && importable.length === 0 ? (
            <p className="muted small" style={{ marginTop: 8 }}>No hay más assets en tu cuenta para este tipo.</p>
          ) : null}
        </div>

        {/* Grid of assets */}
        <div className="card card--list">
          <label className="card__label">
            {TAB_LABEL[tab]} {assets.length ? `(${assets.length})` : ""}
          </label>
          {assets.length === 0 ? (
            <p className="muted small">
              Aún no hay {TAB_LABEL[tab].toLowerCase()}. {tab === "style" ? "Define uno" : "Genera uno"} arriba.
            </p>
          ) : (
            <div className="asset-grid">
              {assets.map((a) => {
                const isStyle = a.type === "style";
                const active = isStyle && project.styleId === a.id;
                const ready = !!a.magnificIdentifier;
                return (
                  <div
                    className={`asset-card ${active ? "asset-card--active" : ""} ${highlight === a.id ? "asset-card--focus" : ""}`}
                    key={a.id}
                    ref={highlight === a.id ? focusRef : undefined}
                  >
                    <div className="asset-card__thumb">
                      {a.thumbnailUrl ? (
                        <img className="asset-clickable" src={a.thumbnailUrl} alt={a.name} onClick={() => setPreview({ url: a.thumbnailUrl!, kind: "image" })} />
                      ) : (
                        <div className="kf__empty">sin imagen</div>
                      )}
                      {a.job?.status === "rendering" || a.job?.status === "queued" ? (
                        <div className="queue" style={{ position: "absolute", left: 6, right: 6, bottom: 6 }}>
                          <div className="queue__bar" style={{ width: `${a.job.progress}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <input className="asset-card__name" value={a.name} onChange={(e) => rename(a.id, e.target.value)} />
                    {isStyle ? (
                      <textarea
                        className="kf__prompt"
                        value={a.prompt ?? ""}
                        onChange={(e) => setStyleText(a.id, e.target.value)}
                      />
                    ) : (
                      <div className="kf__row muted small">
                        <JobBadge job={a.job} etaSec={40} />
                        {ready ? <span className="asset-card__ok"><IconCheck size={13} /> en biblioteca</span> : null}
                      </div>
                    )}
                    <div className="kf__actions">
                      {isStyle ? (
                        <button className={active ? "is-on" : ""} onClick={() => useAsStyle(a.id)}>
                          {active ? (<><IconCheck size={14} /> Estilo activo</>) : "Usar como estilo global"}
                        </button>
                      ) : (
                        <>
                          {a.job?.status === "ready" ? (
                            <button onClick={() => runAsset(a.id, a.prompt ?? "", model)}>
                              <IconRefresh size={14} /> Regenerar
                            </button>
                          ) : null}
                          {a.job?.status === "ready" && !ready ? (
                            <button className="action action--gen" onClick={() => saveToLibrary(a.id)}>
                              Guardar en biblioteca
                            </button>
                          ) : null}
                          {a.thumbnailUrl ? (
                            <button
                              disabled={a.sheetJob?.status === "rendering" || a.sheetJob?.status === "queued"}
                              onClick={() => void generateAssetSheet(store, a.id)}
                              title={a.type === "character"
                                ? "Genera una hoja de personaje (varias vistas) como referencia extra"
                                : "Genera un grid 3×3 con varios puntos de vista del entorno"}
                            >
                              {a.type === "character" ? "Hoja de personaje" : "Grid 3×3"}
                            </button>
                          ) : null}
                        </>
                      )}
                      <button className="icon-btn" title="Eliminar" onClick={() => remove(a.id)}>
                        <IconTrash size={15} />
                      </button>
                    </div>
                    {a.sheetJob && a.sheetJob.status !== "ready" ? (
                      <div className="kf__row muted small">
                        <JobBadge job={a.sheetJob} etaSec={60} />
                      </div>
                    ) : null}
                    {a.images && a.images.length > 1 ? (
                      <div className="asset-extras">
                        {a.images.slice(1).map((url, i) => (
                          <img
                            key={i}
                            className="asset-clickable"
                            src={url}
                            alt={`${a.name} vista ${i + 2}`}
                            onClick={() => setPreview({ url, kind: "image" })}
                          />
                        ))}
                      </div>
                    ) : null}
                    {a.job?.status === "failed" && a.job.error ? (
                      <p className="muted small" style={{ color: "var(--err, #d05656)" }}>{a.job.error}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {preview ? <AssetModal {...preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
