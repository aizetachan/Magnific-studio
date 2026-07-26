import { useEffect, useState } from "react";
import { IconDownload, IconMountain, IconPalette, IconPlus, IconUser } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { config } from "@/config";
import { uid } from "@/state/seed";
import { AssetDetailModal, AssetImg } from "./AssetDetailModal";
import { isJobRunning } from "@/blocks/runner";

/**
 * Library (§ Historia) — dashboard-style grid grouped by type. Each card is
 * just cover + name + type + image count; EVERYTHING else (generate, edit,
 * upload, poses, description, delete, style text) lives in the asset modal.
 */

type GroupType = "character" | "location" | "style";

const GROUPS: Array<{ type: GroupType; label: string; singular: string }> = [
  { type: "character", label: "Personajes", singular: "Personaje" },
  { type: "location", label: "Entornos", singular: "Entorno" },
  { type: "style", label: "Estilo", singular: "Estilo" },
];

/** UI-only placeholder icon while the asset has no image applied. */
const PH_ICON: Record<GroupType, typeof IconUser> = {
  character: IconUser,
  location: IconMountain,
  style: IconPalette,
};

const MCP_TYPE: Record<GroupType, string> = {
  character: "character",
  location: "locations",
  style: "style",
};

export function LibraryPage({ focusAssetId }: { focusAssetId?: string | null }) {
  const { project, update } = useStore();
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [tab, setTab] = useState<GroupType>("character");

  // Deep link (e.g. from casting): switch to the asset's tab and open its modal.
  useEffect(() => {
    if (!focusAssetId) return;
    const a = (project.library ?? []).find((x) => x.id === focusAssetId);
    if (a) setTab(a.type === "location" ? "location" : a.type === "style" ? "style" : "character");
    setOpenAsset(focusAssetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAssetId]);

  // Import existing assets from the user's Magnific account, per group.
  const [importFor, setImportFor] = useState<GroupType | null>(null);
  const [importable, setImportable] = useState<
    { identifier: string; name: string; thumbnail?: string }[] | null
  >(null);
  const [syncing, setSyncing] = useState(false);

  const sync = async (type: GroupType) => {
    setImportFor(type);
    setSyncing(true);
    setImportable(null);
    try {
      const res = await fetch(`${config.directorBase}/library-list?type=${MCP_TYPE[type]}`, {
        credentials: "include",
      });
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

  const importAsset = (type: GroupType, entry: { identifier: string; name: string; thumbnail?: string }) => {
    update((d) => {
      d.library = d.library ?? [];
      d.library.push({
        id: uid("asset"),
        type,
        name: entry.name,
        magnificIdentifier: entry.identifier,
        thumbnailUrl: entry.thumbnail,
        images: entry.thumbnail ? [entry.thumbnail] : [],
        createdAt: Date.now(),
      });
    });
    setImportable((xs) => (xs ?? []).filter((x) => x.identifier !== entry.identifier));
  };

  const addNew = (type: GroupType) => {
    const id = uid("asset");
    const count = (project.library ?? []).filter((a) => a.type === type).length;
    const g = GROUPS.find((x) => x.type === type)!;
    update((d) => {
      d.library = d.library ?? [];
      d.library.push({ id, type, name: `${g.singular} ${count + 1}`, prompt: "", createdAt: Date.now() });
    });
    setOpenAsset(id);
  };

  return (
    <div className="librarypage">
      <div className="seg librarypage__tabs">
        {GROUPS.map((g) => (
          <button
            key={g.type}
            className={`seg__btn ${tab === g.type ? "is-on" : ""}`}
            onClick={() => setTab(g.type)}
          >
            {g.label}
          </button>
        ))}
      </div>
      {GROUPS.filter((g) => g.type === tab).map((g) => {
        const assets = (project.library ?? []).filter((a) => a.type === g.type);
        return (
          <section className="librarypage__group" key={g.type}>
            <div className="dlib__grouptitle librarypage__grouphead">
              <strong>
                {g.label} {assets.length ? `(${assets.length})` : ""}
              </strong>
              <button className="mini" disabled={syncing && importFor === g.type} onClick={() => void sync(g.type)}>
                <IconDownload size={13} /> {syncing && importFor === g.type ? "Buscando…" : "Importar de tu cuenta"}
              </button>
            </div>

            {importFor === g.type && importable ? (
              importable.length === 0 ? (
                <p className="muted small">No hay más assets de este tipo en tu cuenta de Magnific.</p>
              ) : (
                <div className="librarypage__import">
                  {importable.map((e) => (
                    <div className="music-item" key={e.identifier}>
                      {e.thumbnail ? (
                        <img src={e.thumbnail} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
                      ) : null}
                      <span className="music-item__name">{e.name}</span>
                      <button className="mini" onClick={() => importAsset(g.type, e)}>Añadir</button>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            <div className="dlib__grid">
              {assets.map((a) => {
                const count = (a.images ?? (a.thumbnailUrl ? [a.thumbnailUrl] : [])).length;
                const running = isJobRunning(a.job);
                return (
                  <button className="dlib__card librarypage__card" key={a.id} onClick={() => setOpenAsset(a.id)}>
                    <div className="dlib__img">
                      {/* Type icon underneath: visible until a real image
                          resolves on top (UI-only cover, never used as data). */}
                      {(() => {
                        const Ph = PH_ICON[g.type];
                        return (
                          <div className="librarypage__ph">
                            <Ph size={30} stroke={1.5} />
                          </div>
                        );
                      })()}
                      {a.thumbnailUrl || a.images?.[0] ? (
                        <AssetImg
                          candidates={[a.thumbnailUrl ?? "", ...(a.images ?? [])]}
                          projectId={project.id}
                          alt={a.name}
                          className="librarypage__cover"
                        />
                      ) : null}
                      <span className="librarypage__count">{count}/6</span>
                      {running ? (
                        <div className="queue" style={{ position: "absolute", left: 6, right: 6, bottom: 6 }}>
                          <div className="queue__bar" style={{ width: `${a.job?.progress ?? 5}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <div className="dlib__meta">
                      <strong>{a.name}</strong>
                      <span className="muted small">{g.singular}</span>
                    </div>
                  </button>
                );
              })}
              {/* New asset card */}
              {g.type !== "style" || assets.length === 0 ? (
                <button className="dlib__card librarypage__card librarypage__card--new" onClick={() => addNew(g.type)}>
                  <div className="dlib__img librarypage__newimg">
                    <IconPlus size={26} />
                  </div>
                  <div className="dlib__meta">
                    <strong>Nuevo {g.singular.toLowerCase()}</strong>
                    <span className="muted small">Crear</span>
                  </div>
                </button>
              ) : null}
            </div>
          </section>
        );
      })}

      {openAsset ? <AssetDetailModal assetId={openAsset} onClose={() => setOpenAsset(null)} /> : null}
    </div>
  );
}
