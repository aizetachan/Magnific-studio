import { useState } from "react";
import {
  IconBook,
  IconCheck,
  IconRefresh,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { GateButton } from "@/components/GateButton";
import { generateStoryField } from "@/director/generate";
import { uid } from "@/state/seed";
import { config } from "@/config";

type Field = "logline" | "tone" | "characters" | "arcs";

export function StoryPage() {
  const store = useStore();
  const { project, update } = store;
  const block = useActiveBlock();
  const s = project.story;
  const [busyField, setBusyField] = useState<Field | null>(null);
  const [libBusy, setLibBusy] = useState<string | null>(null);

  /** Promote a character to the Magnific Library so it stays consistent across shots. */
  const createInLibrary = async (charId: string) => {
    const c = project.story.characters.find((x) => x.id === charId);
    if (!c || libBusy) return;
    if (!c.photoUrl?.startsWith("http")) {
      alert("Añade primero una URL de imagen de referencia (https) para el personaje.");
      return;
    }
    setLibBusy(charId);
    try {
      const res = await fetch(`${config.directorBase}/library-create`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: c.name || `personaje-${charId}`,
          type: "character",
          description: c.description || undefined,
          images: [{ url: c.photoUrl }],
        }),
      });
      const data = (await res.json()) as { ok: boolean; identifier?: string; error?: string };
      if (!data.ok || !data.identifier) throw new Error(data.error ?? "No se pudo crear");
      update((d) => {
        const t = d.story.characters.find((x) => x.id === charId);
        if (t) t.libraryId = String(data.identifier);
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLibBusy(null);
    }
  };

  /** Regenerate only one block (e.g. just tone) with Claude. */
  const regenField = async (field: Field) => {
    if (busyField) return;
    setBusyField(field);
    try {
      await generateStoryField(store, field);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyField(null);
    }
  };

  /** Small per-block "regenerate this block" icon button. */
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

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1><IconBook size={24} /> Historia</h1>
          <p className="muted">
            Desarrolla la narrativa. Claude aquí SOLO trabaja texto: nada de
            imágenes ni vídeo.
          </p>
        </div>
        <GateButton
          state={block.getGateState()}
          label="Historia lista → escribir guion"
          onValidate={block.validate}
        />
      </header>

      <ContextualActions actions={block.getActions()} />

      {!s.logline && s.characters.length === 0 ? (
        <p className="onboard">
          Empieza aquí: escribe tu idea en el <b>Logline</b> y pulsa{" "}
          <b>Desarrollar historia desde una idea</b> — Claude propondrá logline,
          personajes y arcos. Luego en <b>Guion</b> generará las escenas.
        </p>
      ) : null}

      <section className="cards">
        <div className="card">
          <div className="card__listhead">
            <label className="card__label">Logline</label>
            <RegenBtn field="logline" />
          </div>
          <textarea
            value={s.logline}
            onChange={(e) =>
              update((d) => {
                d.story.logline = e.target.value;
              })
            }
          />
        </div>

        <div className="card">
          <div className="card__listhead">
            <label className="card__label">Tono / género / referencias</label>
            <RegenBtn field="tone" />
          </div>
          <textarea
            value={s.tone}
            onChange={(e) =>
              update((d) => {
                d.story.tone = e.target.value;
              })
            }
          />
        </div>
      </section>

      <section className="cards">
        <div className="card card--list">
          <div className="card__listhead">
            <label className="card__label">Personajes</label>
            <span className="kf__row" style={{ margin: 0 }}>
              <RegenBtn field="characters" />
              <button
                className="mini"
                onClick={() =>
                  update((d) => {
                    d.story.characters.push({
                      id: uid("char"),
                      name: "Nuevo personaje",
                      description: "",
                    });
                  })
                }
              >
                + Añadir
              </button>
            </span>
          </div>
          {s.characters.map((c) => (
            <div className="char-row" key={c.id}>
              <div className="row">
                <input
                  className="row__title"
                  value={c.name}
                  onChange={(e) =>
                    update((d) => {
                      const t = d.story.characters.find((x) => x.id === c.id)!;
                      t.name = e.target.value;
                    })
                  }
                />
                <input
                  className="row__desc"
                  value={c.description}
                  placeholder="Descripción"
                  onChange={(e) =>
                    update((d) => {
                      const t = d.story.characters.find((x) => x.id === c.id)!;
                      t.description = e.target.value;
                    })
                  }
                />
              </div>
              <div className="char-lib">
                {c.libraryId ? (
                  <span className="char-lib__ok">
                    <IconCheck size={14} /> En biblioteca · coherencia activa
                    <button
                      className="icon-btn"
                      title="Quitar de la biblioteca (deja de usarse como referencia)"
                      onClick={() =>
                        update((d) => {
                          const t = d.story.characters.find((x) => x.id === c.id);
                          if (t) t.libraryId = undefined;
                        })
                      }
                    >
                      <IconX size={13} />
                    </button>
                  </span>
                ) : (
                  <>
                    <input
                      className="char-lib__url"
                      value={c.photoUrl ?? ""}
                      placeholder="URL de imagen de referencia (https)…"
                      onChange={(e) =>
                        update((d) => {
                          const t = d.story.characters.find((x) => x.id === c.id)!;
                          t.photoUrl = e.target.value;
                        })
                      }
                    />
                    <button
                      className="mini"
                      title="Crea el personaje en la biblioteca de Magnific para mantenerlo consistente en todos los planos"
                      disabled={libBusy !== null}
                      onClick={() => createInLibrary(c.id)}
                    >
                      {libBusy === c.id ? (
                        <span className="spin" />
                      ) : (
                        <>
                          <IconUserPlus size={14} /> Crear en biblioteca
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card card--list">
          <div className="card__listhead">
            <label className="card__label">Arcos narrativos</label>
            <span className="kf__row" style={{ margin: 0 }}>
              <RegenBtn field="arcs" />
              <button
                className="mini"
                onClick={() =>
                  update((d) => {
                    d.story.arcs.push({
                      id: uid("arc"),
                      title: "Nuevo arco",
                      description: "",
                    });
                  })
                }
              >
                + Añadir
              </button>
            </span>
          </div>
          {s.arcs.map((a) => (
            <div className="row" key={a.id}>
              <input
                className="row__title"
                value={a.title}
                onChange={(e) =>
                  update((d) => {
                    const t = d.story.arcs.find((x) => x.id === a.id)!;
                    t.title = e.target.value;
                  })
                }
              />
              <input
                className="row__desc"
                value={a.description}
                placeholder="Descripción"
                onChange={(e) =>
                  update((d) => {
                    const t = d.story.arcs.find((x) => x.id === a.id)!;
                    t.description = e.target.value;
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
