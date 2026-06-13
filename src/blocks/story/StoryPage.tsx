import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { GateButton } from "@/components/GateButton";
import { uid } from "@/state/seed";

export function StoryPage() {
  const { project, update } = useStore();
  const block = useActiveBlock();
  const s = project.story;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>📖 Historia</h1>
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

      <section className="cards">
        <div className="card">
          <label className="card__label">Logline</label>
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
          <label className="card__label">Tono / género / referencias</label>
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
          </div>
          {s.characters.map((c) => (
            <div className="row" key={c.id}>
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
          ))}
        </div>

        <div className="card card--list">
          <div className="card__listhead">
            <label className="card__label">Arcos narrativos</label>
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
