import { useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconExternalLink,
  IconMountain,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { LeadSlotContext } from "@/state/LeadSlot";
import { ContextualActions } from "@/components/ContextualActions";
import { OnboardingToast } from "@/components/OnboardingToast";
import { JobBadge } from "@/components/JobBadge";
import { AssetModal, type PreviewAsset } from "@/components/AssetModal";
import { RefDetailModal } from "@/components/RefDetailModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  characterPrompt,
  environmentPrompt,
  generateStoryField,
} from "@/director/generate";
import { generateAssetPreview, generateAssetPreviews } from "@/blocks/runner";
import { uid } from "@/state/seed";
import { showAppAlert } from "@/components/AppAlert";

type Field = "logline" | "tone" | "characters" | "arcs";

/** Standard narrative arcs shown as an empty-state suggestion (click to add). */
const STANDARD_ARCS: { title: string; description: string }[] = [
  { title: "Planteamiento", description: "Presentación del mundo, los personajes y el conflicto." },
  { title: "Nudo", description: "Desarrollo, complicaciones y punto de giro." },
  { title: "Clímax", description: "Momento de máxima tensión y la decisión clave." },
  { title: "Desenlace", description: "Resolución del conflicto y cierre de la historia." },
];

/** Jump to the Library focused on a specific asset (for editing). */
const openInLibrary = (assetId: string) =>
  window.dispatchEvent(new CustomEvent("ms:open-library", { detail: { assetId } }));

export function StoryPage() {
  const store = useStore();
  const { project, update } = store;
  const block = useActiveBlock();
  const s = project.story;
  const [busyField, setBusyField] = useState<Field | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewAsset | null>(null);
  // Which reference (character/environment) detail modal is open.
  const [detail, setDetail] = useState<{ kind: "character" | "environment"; id: string } | null>(null);
  const [tab, setTab] = useState<"idea" | "casting">("idea");
  const [confirmGen, setConfirmGen] = useState(false);
  const leadSlot = useContext(LeadSlotContext);

  const lib = project.library ?? [];
  const styleAsset = project.styleId ? lib.find((a) => a.id === project.styleId) : undefined;
  const environments = lib.filter((a) => a.type === "location");
  const assetOf = (assetId?: string) => (assetId ? lib.find((a) => a.id === assetId) : undefined);

  const regenField = async (field: Field) => {
    if (busyField) return;
    setBusyField(field);
    try {
      await generateStoryField(store, field);
    } catch (e) {
      showAppAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyField(null);
    }
  };

  // Full story generation (the block's primary action) — lives in the Idea card.
  const developAction = block.getActions().find((a) => a.id === "develop_story");
  const runDevelop = async () => {
    if (!developAction || generating) return;
    setGenerating(true);
    try {
      await developAction.run();
    } catch (e) {
      showAppAlert(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const addArc = (arc: { title: string; description: string }) =>
    update((d) => {
      d.story.arcs.push({ id: uid("arc"), title: arc.title, description: arc.description });
    });

  const RegenBtn = ({ field }: { field: Field }) => (
    <button
      className="icon-btn"
      title="Regenerar solo este bloque con Claude"
      disabled={busyField !== null}
      onClick={() => regenField(field)}
    >
      {busyField === field ? <span className="spin" /> : <IconRefresh size={15} />}
    </button>
  );

  const runPreviews = async () => {
    setPreviewing(true);
    try {
      await generateAssetPreviews(store);
    } finally {
      setPreviewing(false);
    }
  };

  // --- Characters (narrative) linked to a Library character asset ---
  const setCharField = (charId: string, field: "name" | "description", value: string) =>
    update((d) => {
      const c = d.story.characters.find((x) => x.id === charId);
      if (!c) return;
      c[field] = value;
      const a = c.libraryAssetId ? d.library?.find((x) => x.id === c.libraryAssetId) : undefined;
      if (a) {
        if (field === "name") a.name = value;
        else a.description = value;
        a.prompt = characterPrompt(a.name, a.description ?? "");
      }
    });

  const addCharacter = () =>
    update((d) => {
      d.library = d.library ?? [];
      const assetId = uid("asset");
      const name = "Nuevo personaje";
      // Default description so it's never empty (works even without Claude/API).
      const description = "Personaje principal de la historia, aspecto realista y cinematográfico.";
      d.library.push({ id: assetId, type: "character", name, description, prompt: characterPrompt(name, description), createdAt: Date.now() });
      d.story.characters.push({ id: uid("char"), name, description, libraryAssetId: assetId });
    });

  const removeCharacter = (charId: string) =>
    update((d) => {
      const c = d.story.characters.find((x) => x.id === charId);
      if (c?.libraryAssetId) d.library = (d.library ?? []).filter((a) => a.id !== c.libraryAssetId);
      d.story.characters = d.story.characters.filter((x) => x.id !== charId);
    });

  /** Ensure the character has a linked library asset, then (re)generate its image. */
  const regenCharacter = async (charId: string) => {
    let assetId = project.story.characters.find((c) => c.id === charId)?.libraryAssetId;
    if (!assetId) {
      assetId = uid("asset");
      update((d) => {
        const c = d.story.characters.find((x) => x.id === charId);
        if (!c) return;
        d.library = d.library ?? [];
        d.library.push({ id: assetId!, type: "character", name: c.name, description: c.description, prompt: characterPrompt(c.name, c.description), createdAt: Date.now() });
        c.libraryAssetId = assetId;
      });
    }
    await generateAssetPreview(store, assetId);
  };

  // --- Environments (Library location assets) ---
  const setEnvField = (assetId: string, field: "name" | "description", value: string) =>
    update((d) => {
      const a = d.library?.find((x) => x.id === assetId);
      if (!a) return;
      if (field === "name") a.name = value;
      else a.description = value;
      a.prompt = environmentPrompt(a.name, a.description ?? "");
    });

  const addEnvironment = () =>
    update((d) => {
      d.library = d.library ?? [];
      const name = "Nuevo entorno";
      // Default description so it's never empty (works even without Claude/API).
      const description = "Localización cinematográfica con iluminación natural.";
      d.library.push({ id: uid("asset"), type: "location", name, description, prompt: environmentPrompt(name, description), createdAt: Date.now() });
    });

  const removeEnvironment = (assetId: string) =>
    update((d) => {
      d.library = (d.library ?? []).filter((a) => a.id !== assetId);
      for (const sc of d.scenes) if (sc.locationId === assetId) sc.locationId = undefined;
    });

  // Whether the page already has generated content that "Generar historia" would
  // overwrite (the Idea itself is just the input, so it doesn't count).
  const hasGenerated = !!(
    s.tone.trim() ||
    s.arcs.length ||
    s.characters.length ||
    environments.length ||
    styleAsset?.prompt?.trim()
  );

  // Resolve the open detail (character/environment) to live data for the modal.
  let detailModal: ReactNode = null;
  if (detail?.kind === "character") {
    const c = s.characters.find((x) => x.id === detail.id);
    if (c) {
      const a = assetOf(c.libraryAssetId);
      detailModal = (
        <RefDetailModal
          kindLabel="Personaje"
          name={c.name}
          description={c.description}
          prompt={a?.prompt ?? characterPrompt(c.name, c.description)}
          imageUrl={a?.thumbnailUrl}
          onName={(v) => setCharField(c.id, "name", v)}
          onDescription={(v) => setCharField(c.id, "description", v)}
          onPrompt={(v) =>
            update((d) => {
              const ch = d.story.characters.find((x) => x.id === c.id);
              const asset = ch?.libraryAssetId ? d.library?.find((x) => x.id === ch.libraryAssetId) : undefined;
              if (asset) asset.prompt = v;
            })
          }
          onClose={() => setDetail(null)}
        />
      );
    }
  } else if (detail?.kind === "environment") {
    const a = environments.find((x) => x.id === detail.id);
    if (a) {
      detailModal = (
        <RefDetailModal
          kindLabel="Entorno"
          name={a.name}
          description={a.description ?? ""}
          prompt={a.prompt ?? environmentPrompt(a.name, a.description ?? "")}
          imageUrl={a.thumbnailUrl}
          onName={(v) => setEnvField(a.id, "name", v)}
          onDescription={(v) => setEnvField(a.id, "description", v)}
          onPrompt={(v) =>
            update((d) => {
              const env = d.library?.find((x) => x.id === a.id);
              if (env) env.prompt = v;
            })
          }
          onClose={() => setDetail(null)}
        />
      );
    }
  }

  return (
    <div className="page">
      <ContextualActions actions={block.getActions()} />

      {!s.logline && s.characters.length === 0 ? (
        <OnboardingToast storageKey="ms_onboard_story">
          Empieza aquí: escribe tu idea en <b>Idea</b> y pulsa{" "}
          <b>Generar historia</b> — Claude propondrá la idea, estilo visual,
          personajes (con imagen), entornos y arcos.
        </OnboardingToast>
      ) : null}

      {/* Idea / Casting tabs — portaled into the page lead row (right side). */}
      {leadSlot
        ? createPortal(
            <div className="seg">
              <button className={`seg__btn ${tab === "idea" ? "is-on" : ""}`} onClick={() => setTab("idea")}>Idea</button>
              <button className={`seg__btn ${tab === "casting" ? "is-on" : ""}`} onClick={() => setTab("casting")}>Casting</button>
            </div>,
            leadSlot,
          )
        : null}

      {tab === "idea" ? (
      <div className="story-cols">
        <div className="story-col">
          <div className="card" data-flash="logline">
            <div className="card__listhead">
              <label className="card__label">Idea</label>
              <span className="kf__row" style={{ margin: 0 }}>
                <RegenBtn field="logline" />
                <button
                  className="action action--gen"
                  disabled={generating || !developAction}
                  onClick={() => (hasGenerated ? setConfirmGen(true) : runDevelop())}
                >
                  {generating ? <><span className="spin" /> Generando…</> : "Generar historia"}
                </button>
              </span>
            </div>
            <textarea value={s.logline} onChange={(e) => update((d) => { d.story.logline = e.target.value; })} />
          </div>

          <div className="card" data-flash="style">
            <div className="card__listhead">
              <label className="card__label"><IconSparkles size={15} /> Estilo visual (global)</label>
            </div>
            <p className="muted small">
              Se aplica a TODAS las imágenes (personajes, entornos y planos) para mantener
              la consistencia visual.
            </p>
            <textarea
              placeholder="Define el estilo: técnica, paleta, iluminación, referencias…"
              value={styleAsset?.prompt ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.library = d.library ?? [];
                  let a = d.styleId ? d.library.find((x) => x.id === d.styleId) : undefined;
                  if (!a) {
                    a = { id: uid("asset"), type: "style", name: "Estilo del corto", prompt: "", createdAt: Date.now() };
                    d.library.push(a);
                    d.styleId = a.id;
                  }
                  a.prompt = e.target.value;
                })
              }
            />
          </div>
        </div>

        <div className="story-col">
          <div className="card" data-flash="tone">
            <div className="card__listhead">
              <label className="card__label">Tono / género / referencias</label>
              <RegenBtn field="tone" />
            </div>
            <textarea value={s.tone} onChange={(e) => update((d) => { d.story.tone = e.target.value; })} />
          </div>

          <div className="card card--list">
            <div className="card__listhead">
              <label className="card__label">Arcos narrativos</label>
              <span className="kf__row" style={{ margin: 0 }}>
                <RegenBtn field="arcs" />
                <button className="mini" onClick={() => update((d) => { d.story.arcs.push({ id: uid("arc"), title: "Nuevo arco", description: "" }); })}>+ Añadir</button>
              </span>
            </div>
            {s.arcs.length === 0
              ? STANDARD_ARCS.map((arc) => (
                  <button className="row row--empty" key={arc.title} title="Añadir este arco a tu historia" onClick={() => addArc(arc)}>
                    <span className="row__title">{arc.title}</span>
                    <span className="row__desc">{arc.description}</span>
                  </button>
                ))
              : s.arcs.map((a) => (
                  <div className="row" key={a.id}>
                    <input className="row__title" value={a.title} onChange={(e) => update((d) => { const t = d.story.arcs.find((x) => x.id === a.id)!; t.title = e.target.value; })} />
                    <input className="row__desc" value={a.description} placeholder="Descripción" onChange={(e) => update((d) => { const t = d.story.arcs.find((x) => x.id === a.id)!; t.description = e.target.value; })} />
                  </div>
                ))}
          </div>
        </div>
      </div>
      ) : (
      <div className="story-cols">
        <div className="story-col">
        <div className="card card--list">
          <div className="card__listhead">
            <label className="card__label">Actores</label>
            <span className="kf__row" style={{ margin: 0 }}>
              <RegenBtn field="characters" />
              <button className="mini" disabled={previewing} onClick={runPreviews} title="Generar las imágenes que falten con el estilo">
                {previewing ? <span className="spin" /> : <IconPhoto size={14} />} Generar previews
              </button>
              <button className="mini" onClick={addCharacter}>+ Añadir</button>
            </span>
          </div>
          {s.characters.length === 0 ? (
            <div className="ref-row ref-row--empty">
              <button className="ref-row__open" onClick={addCharacter} title="Añadir un personaje">
                <div className="ref-row__thumb"><span className="ref-row__ph"><IconUser size={18} /></span></div>
                <div className="ref-row__body">
                  <span className="row__title">Protagonista</span>
                  <span className="row__desc">Genera la historia para proponer personajes, o añade uno.</span>
                </div>
              </button>
              <div className="ref-row__actions">
                <button className="icon-btn" title="Añadir personaje" onClick={addCharacter}><IconPlus size={15} /></button>
              </div>
            </div>
          ) : null}
          {s.characters.map((c) => {
            const a = assetOf(c.libraryAssetId);
            return (
              <div className="ref-row" key={c.id}>
                <button className="ref-row__open" onClick={() => setDetail({ kind: "character", id: c.id })} title="Ver detalle del personaje">
                  <div className="ref-row__thumb">
                    {a?.thumbnailUrl ? (
                      <img src={a.thumbnailUrl} alt={c.name} />
                    ) : (
                      <span className="ref-row__ph"><IconPhoto size={18} /></span>
                    )}
                  </div>
                  <div className="ref-row__body">
                    <span className="row__title">{c.name || "Sin nombre"}</span>
                    <span className="row__desc">{c.description || "Sin descripción"}</span>
                  </div>
                </button>
                <div className="ref-row__side">
                  <div className="ref-row__actions">
                    <button className="icon-btn" title="Generar / regenerar imagen" onClick={() => regenCharacter(c.id)}>
                      <IconRefresh size={15} />
                    </button>
                    {c.libraryAssetId ? (
                      <button className="icon-btn" title="Editar en Biblioteca" onClick={() => openInLibrary(c.libraryAssetId!)}>
                        <IconExternalLink size={15} />
                      </button>
                    ) : null}
                    <button className="icon-btn" title="Eliminar" onClick={() => removeCharacter(c.id)}>
                      <IconTrash size={15} />
                    </button>
                  </div>
                  <div className="ref-row__status kf__row muted small">
                    <JobBadge job={a?.job} etaSec={40} />
                    {a?.magnificIdentifier ? <span className="asset-card__ok">en biblioteca</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>

        <div className="story-col">
        <div className="card card--list">
          <div className="card__listhead">
            <label className="card__label">Entornos</label>
            <button className="mini" onClick={addEnvironment}>+ Añadir</button>
          </div>
          {environments.length === 0 ? (
            <div className="ref-row ref-row--empty">
              <button className="ref-row__open" onClick={addEnvironment} title="Añadir un entorno">
                <div className="ref-row__thumb"><span className="ref-row__ph"><IconMountain size={18} /></span></div>
                <div className="ref-row__body">
                  <span className="row__title">Entorno principal</span>
                  <span className="row__desc">Claude propondrá los entornos al generar la historia, o añade uno.</span>
                </div>
              </button>
              <div className="ref-row__actions">
                <button className="icon-btn" title="Añadir entorno" onClick={addEnvironment}><IconPlus size={15} /></button>
              </div>
            </div>
          ) : (
            environments.map((a) => (
              <div className="ref-row" key={a.id}>
                <button className="ref-row__open" onClick={() => setDetail({ kind: "environment", id: a.id })} title="Ver detalle del entorno">
                  <div className="ref-row__thumb">
                    {a.thumbnailUrl ? (
                      <img src={a.thumbnailUrl} alt={a.name} />
                    ) : (
                      <span className="ref-row__ph"><IconPhoto size={18} /></span>
                    )}
                  </div>
                  <div className="ref-row__body">
                    <span className="row__title">{a.name || "Sin nombre"}</span>
                    <span className="row__desc">{a.description || "Sin descripción"}</span>
                  </div>
                </button>
                <div className="ref-row__side">
                  <div className="ref-row__actions">
                    <button className="icon-btn" title="Generar / regenerar imagen" onClick={() => generateAssetPreview(store, a.id)}>
                      <IconRefresh size={15} />
                    </button>
                    <button className="icon-btn" title="Editar en Biblioteca" onClick={() => openInLibrary(a.id)}>
                      <IconExternalLink size={15} />
                    </button>
                    <button className="icon-btn" title="Eliminar" onClick={() => removeEnvironment(a.id)}>
                      <IconTrash size={15} />
                    </button>
                  </div>
                  <div className="ref-row__status kf__row muted small">
                    <JobBadge job={a.job} etaSec={40} />
                    {a.magnificIdentifier ? <span className="asset-card__ok">en biblioteca</span> : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        </div>
      </div>
      )}

      {preview ? <AssetModal {...preview} onClose={() => setPreview(null)} /> : null}
      {detailModal}
      {confirmGen ? (
        <ConfirmModal
          title="Generar historia de nuevo"
          message={
            <>
              Esto <b>sobrescribirá el contenido actual de esta página</b>: Idea,
              Tono/género, Estilo visual, <b>Actores</b> y <b>Entornos</b> y Arcos.
              ¿Quieres continuar?
            </>
          }
          confirmLabel="Sobrescribir y generar"
          onConfirm={() => {
            setConfirmGen(false);
            void runDevelop();
          }}
          onCancel={() => setConfirmGen(false)}
        />
      ) : null}
    </div>
  );
}
