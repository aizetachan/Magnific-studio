import { useEffect, useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconEye,
  IconLock,
  IconPlus,
  IconTrash,
  IconWriting,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { ContextualActions } from "@/components/ContextualActions";
import { GateButton } from "@/components/GateButton";
import { downloadText } from "@/state/download";
import { newShot, uid } from "@/state/seed";
import { formatScript } from "./format";

export function ScriptPage() {
  const { project, update } = useStore();
  const block = useActiveBlock();
  const gate = block.getGateState();
  const [previewOpen, setPreviewOpen] = useState(false);

  if (gate === "locked") {
    return <LockedNotice />;
  }

  const scriptText = formatScript(project);
  const fileName = `${project.name.replace(/\s+/g, "-").toLowerCase()}-guion.txt`;

  // Move a scene up/down in the running order (renumbers; shots follow by sceneId).
  const moveScene = (id: string, dir: -1 | 1) =>
    update((d) => {
      const i = d.scenes.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.scenes.length) return;
      [d.scenes[i], d.scenes[j]] = [d.scenes[j], d.scenes[i]];
      d.scenes.forEach((x, k) => (x.number = k + 1));
    });

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1><IconWriting size={24} /> Guion</h1>
          <p className="muted">Guion profesional, escena a escena.</p>
        </div>
        <GateButton
          state={gate}
          label="Guion validado → generar storyboard"
          onValidate={block.validate}
        />
      </header>

      <ContextualActions actions={block.getActions()} />

      <div className="actions">
        <button className="mini" onClick={() => setPreviewOpen(true)}>
          <IconEye size={15} /> Ver guion
        </button>
        <button className="mini" onClick={() => downloadText(fileName, scriptText)}>
          <IconDownload size={15} /> Descargar .txt
        </button>
      </div>

      {previewOpen ? (
        <ScriptPreview
          title={project.name}
          text={scriptText}
          onDownload={() => downloadText(fileName, scriptText)}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      <section className="script">
        {project.scenes.length === 0 ? (
          <p className="muted">
            Aún no hay guion. Pulsa <b>Generar guion desde la historia</b> para
            que Claude proponga las escenas, o añade una escena a mano.
          </p>
        ) : null}
        {project.scenes.map((s, idx) => (
          <article className="scene" key={s.id}>
            <div className="scene__head">
              <input
                className="scene__heading"
                value={s.heading}
                onChange={(e) =>
                  update((d) => {
                    d.scenes.find((x) => x.id === s.id)!.heading =
                      e.target.value;
                  })
                }
              />
              <span className="scene__dur">~{s.durationSec}s</span>
              <button
                className="icon-btn"
                title="Subir escena"
                disabled={idx === 0}
                onClick={() => moveScene(s.id, -1)}
              >
                <IconChevronUp size={15} />
              </button>
              <button
                className="icon-btn"
                title="Bajar escena"
                disabled={idx === project.scenes.length - 1}
                onClick={() => moveScene(s.id, 1)}
              >
                <IconChevronDown size={15} />
              </button>
              <button
                className="icon-btn"
                title="Eliminar escena"
                onClick={() =>
                  update((d) => {
                    d.scenes = d.scenes.filter((x) => x.id !== s.id);
                    d.scenes.forEach((x, i) => (x.number = i + 1));
                    d.shots = d.shots.filter((x) => x.sceneId !== s.id);
                  })
                }
              >
                <IconTrash size={15} />
              </button>
            </div>
            <textarea
              className="scene__action"
              value={s.action}
              onChange={(e) =>
                update((d) => {
                  d.scenes.find((x) => x.id === s.id)!.action = e.target.value;
                })
              }
            />
            <textarea
              className="scene__dialogue"
              value={s.dialogue}
              onChange={(e) =>
                update((d) => {
                  d.scenes.find((x) => x.id === s.id)!.dialogue =
                    e.target.value;
                })
              }
            />
          </article>
        ))}
        <button
          className="mini"
          onClick={() =>
            update((d) => {
              const n = d.scenes.length + 1;
              const id = uid("scene");
              d.scenes.push({
                id,
                number: n,
                heading: `ESCENA ${n} — `,
                action: "",
                dialogue: "",
                durationSec: 8,
              });
              d.shots.push(newShot(id, 1, {}));
            })
          }
        >
          <IconPlus size={15} /> Añadir escena
        </button>
      </section>
    </div>
  );
}

function ScriptPreview({
  title,
  text,
  onDownload,
  onClose,
}: {
  title: string;
  text: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="asset-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="script-modal" onClick={(e) => e.stopPropagation()}>
        <div className="script-modal__head">
          <strong>Guion — {title}</strong>
          <div className="kf__row">
            <button className="mini" onClick={onDownload}>
              <IconDownload size={15} /> Descargar .txt
            </button>
            <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
              <IconX size={16} />
            </button>
          </div>
        </div>
        <pre className="script-modal__body">{text}</pre>
      </div>
    </div>
  );
}

function LockedNotice() {
  return (
    <div className="page locked-page">
      <h1><IconLock size={24} /> Guion</h1>
      <p className="muted">
        Esta fase se desbloquea cuando validas la Historia.
      </p>
    </div>
  );
}
