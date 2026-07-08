import { useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconBook2, IconPhoto } from "@tabler/icons-react";
import type { LibraryAsset, Project } from "@/types/project";
import {
  listProjects,
  loadProject,
  loadProjectFromDir,
  projectColor,
  type ProjectSummary,
} from "@/state/persistence";
import { initLocalDir } from "@/state/localdir";
import { loadProjectAssetBlob } from "@/state/assets";
import { useI18n, type TKey } from "@/i18n";

/**
 * Dashboard Library (opción B): browse any file's characters, environments
 * and style WITHOUT opening the file. Level 1 = pick a file; level 2 = a
 * read-only grid of that file's library. Thumbnails resolve from the file's
 * own folder (local-first), with object URLs scoped to this view.
 */

const TYPE_KEY: Record<string, TKey> = {
  character: "dlib.type.character",
  location: "dlib.type.location",
  style: "dlib.type.style",
};

function coverRef(a: LibraryAsset): string | undefined {
  return a.images?.[0] ?? a.thumbnailUrl ?? undefined;
}

/** Resolve each asset's cover to a displayable URL (http passes through;
 * local: refs are read from THAT project's folder). */
function useCovers(projectId: string | null, assets: LibraryAsset[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const created: string[] = [];
    void (async () => {
      await initLocalDir();
      const out: Record<string, string> = {};
      for (const a of assets) {
        const ref = coverRef(a);
        if (!ref) continue;
        if (!ref.startsWith("local:")) {
          out[a.id] = ref;
          continue;
        }
        const blob = await loadProjectAssetBlob(projectId, ref);
        if (blob) {
          const u = URL.createObjectURL(blob);
          created.push(u);
          out[a.id] = u;
        }
      }
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, assets.length]);
  return urls;
}

export function DashboardLibrary() {
  const { t } = useI18n();
  const projects = useMemo(() => listProjects(), []);
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  // Level 2: load the selected file (localStorage → working folder fallback).
  useEffect(() => {
    if (!selected) {
      setProject(null);
      return;
    }
    let alive = true;
    void (async () => {
      const p = loadProject(selected.id) ?? (await loadProjectFromDir(selected.id));
      if (alive) setProject(p);
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const assets = project?.library ?? [];
  const covers = useCovers(selected?.id ?? null, assets);

  if (!selected) {
    return (
      <div className="dlib">
        <p className="muted">{t("dlib.lead")}</p>
        {projects.length === 0 ? (
          <p className="muted small">{t("dlib.empty")}</p>
        ) : (
          <div className="dlib__files">
            {projects.map((p) => {
              const lib = loadProject(p.id)?.library ?? [];
              return (
                <button className="dlib__file" key={p.id} onClick={() => setSelected(p)}>
                  <span className="dlib__chip" style={{ background: projectColor(p.id) }} />
                  <span className="dlib__filename">{p.name}</span>
                  <span className="muted small">
                    {lib.length} {t("dlib.assets")}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const groups = (["character", "location", "style"] as const).map((type) => ({
    type,
    items: assets.filter((a) => a.type === type),
  }));

  return (
    <div className="dlib">
      <button className="action" onClick={() => setSelected(null)}>
        <IconArrowLeft size={15} /> {t("dlib.back")}
      </button>
      <h2 className="dlib__project">
        <span className="dlib__chip" style={{ background: projectColor(selected.id) }} />
        {selected.name}
      </h2>
      {assets.length === 0 ? (
        <p className="muted">{t("dlib.none")}</p>
      ) : (
        groups.map((g) =>
          g.items.length === 0 ? null : (
            <section key={g.type}>
              <h3 className="dlib__grouptitle">
                <IconBook2 size={16} /> {t(TYPE_KEY[g.type])}
              </h3>
              <div className="dlib__grid">
                {g.items.map((a) => (
                  <article className="dlib__card" key={a.id}>
                    {covers[a.id] ? (
                      <img className="dlib__img" src={covers[a.id]} alt={a.name} />
                    ) : (
                      <div className="dlib__img dlib__img--empty">
                        <IconPhoto size={22} />
                      </div>
                    )}
                    <div className="dlib__meta">
                      <strong>{a.name}</strong>
                      <span className="muted small">{t(TYPE_KEY[a.type] ?? "dlib.type.character")}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ),
        )
      )}
    </div>
  );
}
