import { useEffect, useState } from "react";
import { IconCheck, IconGripVertical, IconMicrophone, IconMusic, IconTrash } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { JobBadge } from "@/components/JobBadge";
import { config } from "@/config";
import { uid } from "@/state/seed";
import { runAudio } from "../runner";
import type { AudioTrack } from "@/types/project";

interface Voice {
  id: number;
  name: string;
  gender?: string;
  language?: string;
}

const MUSIC_MODELS = [
  { slug: "auto", name: "Auto" },
  { slug: "google-lyria", name: "Lyria (30s)" },
  { slug: "google-lyria-3-pro", name: "Lyria 3 Pro (30–180s)" },
  { slug: "elevenlabs-music-generation", name: "ElevenLabs (10–300s)" },
];

/** Voz por escena (TTS del diálogo) + música de fondo, como assets entregables. */
export function AudioSection() {
  const store = useStore();
  const { project, update } = store;
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceId, setVoiceId] = useState<number | undefined>(undefined);
  const [musicModel, setMusicModel] = useState("auto");
  const [musicDur, setMusicDur] = useState(30);
  const [musicPrompt, setMusicPrompt] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`${config.directorBase}/voices`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const list: Voice[] = data.voices ?? [];
        setVoices(list);
        if (list[0]) setVoiceId(list[0].id);
      })
      .catch(() => alive && setVoices([]));
    return () => {
      alive = false;
    };
  }, []);

  const tracks = project.audio ?? [];
  const trackFor = (id: string) => tracks.find((x) => x.id === id);

  /** Create the track (if needed) then run generation. */
  const generate = (
    id: string,
    make: () => AudioTrack,
    opts?: Parameters<typeof runAudio>[2],
  ) => {
    update((d) => {
      d.audio = d.audio ?? [];
      const existing = d.audio.find((x) => x.id === id);
      const next = make();
      if (existing) Object.assign(existing, { prompt: next.prompt, label: next.label });
      else d.audio.push(next);
    });
    void runAudio(store, id, opts);
  };

  const scenesWithDialogue = [...project.scenes]
    .sort((a, b) => a.number - b.number)
    .filter((s) => s.dialogue?.trim());

  const musicTracks = tracks.filter((t) => t.kind === "music");
  const activeMusicId = (project.edit?.audio ?? [])
    .map((p) => p.trackId)
    .find((id) => musicTracks.some((m) => m.id === id));

  /** Generate a NEW music option (previous ones stay as alternatives). */
  const generateMusic = () => {
    if (musicPrompt.trim().length < 10) return;
    const id = uid("music");
    const n = musicTracks.length + 1;
    update((d) => {
      d.audio = d.audio ?? [];
      d.audio.push({ id, kind: "music", label: `Música ${n}`, prompt: musicPrompt });
    });
    void runAudio(store, id, {
      model: musicModel === "auto" ? undefined : musicModel,
      durationSeconds: musicDur,
      prompt: musicPrompt,
      kind: "music",
      label: `Música ${n}`,
    });
  };

  /** Remove a generated music option (and its placement if it was active). */
  const deleteMusic = (trackId: string) =>
    update((d) => {
      d.audio = (d.audio ?? []).filter((t) => t.id !== trackId);
      if (d.edit) d.edit.audio = d.edit.audio.filter((p) => p.trackId !== trackId);
    });

  /** Make a generated music track the active one on the timeline. */
  const useMusic = (trackId: string) =>
    update((d) => {
      d.edit = d.edit ?? { clips: [], audio: [] };
      const ids = new Set((d.audio ?? []).filter((t) => t.kind === "music").map((t) => t.id));
      const ex = d.edit.audio.find((p) => ids.has(p.trackId));
      if (ex) ex.trackId = trackId;
      else d.edit.audio.push({ trackId, offsetSec: 0, volume: 0.35 });
    });

  return (
    <section className="cards">
      <div className="card card--list">
        <div className="card__listhead">
          <label className="card__label">
            <IconMicrophone size={16} /> Voz (locución por escena)
          </label>
          {voices && voices.length > 0 ? (
            <select
              className="model-select"
              value={voiceId ?? ""}
              onChange={(e) => setVoiceId(Number(e.target.value))}
              title="Voz para la locución"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.language ? ` · ${v.language}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">
              {voices === null ? "cargando voces…" : "conecta Magnific para ver voces"}
            </span>
          )}
        </div>

        {scenesWithDialogue.length === 0 ? (
          <p className="muted small">
            No hay diálogos en el guion. Añade diálogo a una escena para generar su
            locución.
          </p>
        ) : (
          scenesWithDialogue.map((sc) => {
            const id = `voice-${sc.id}`;
            const tr = trackFor(id);
            return (
              <div className="audio-row" key={sc.id}>
                <div className="audio-row__head">
                  <span className="tag">Escena {sc.number}</span>
                  <JobBadge job={tr?.job} etaSec={30} />
                </div>
                <textarea
                  className="kf__prompt"
                  value={tr?.prompt ?? sc.dialogue}
                  onChange={(e) =>
                    update((d) => {
                      d.audio = d.audio ?? [];
                      const t = d.audio.find((x) => x.id === id);
                      if (t) t.prompt = e.target.value;
                      else
                        d.audio.push({
                          id,
                          kind: "voice",
                          sceneId: sc.id,
                          label: `Voz · Escena ${sc.number}`,
                          prompt: e.target.value,
                        });
                    })
                  }
                />
                {tr?.url ? <audio src={tr.url} controls className="audio-player" /> : null}
                <div className="kf__actions">
                  <button
                    disabled={tr?.job?.status === "rendering" || tr?.job?.status === "queued"}
                    onClick={() =>
                      generate(
                        id,
                        () => ({
                          id,
                          kind: "voice",
                          sceneId: sc.id,
                          label: `Voz · Escena ${sc.number}`,
                          prompt: tr?.prompt ?? sc.dialogue,
                        }),
                        { voiceId, prompt: tr?.prompt ?? sc.dialogue, kind: "voice", label: `Voz · Escena ${sc.number}` },
                      )
                    }
                  >
                    {tr?.url ? "Regenerar voz" : "Generar voz"}
                  </button>
                  {tr?.url ? (
                    <a className="mini" href={tr.url} download={`escena-${sc.number}-voz`}>
                      Descargar
                    </a>
                  ) : null}
                </div>
                {tr?.job?.status === "failed" && tr.job.error ? (
                  <p className="muted small" style={{ color: "var(--err, #d05656)" }}>
                    {tr.job.error}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="card card--list">
        <div className="card__listhead">
          <label className="card__label">
            <IconMusic size={16} /> Música de fondo
          </label>
        </div>
        <textarea
          className="kf__prompt"
          placeholder="Describe la música: género, ánimo, instrumentos, tempo… (mín. 10 caracteres)"
          value={musicPrompt}
          onChange={(e) => setMusicPrompt(e.target.value)}
        />
        <div className="kf__row muted small">
          <select
            className="model-select"
            value={musicModel}
            onChange={(e) => setMusicModel(e.target.value)}
          >
            {MUSIC_MODELS.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="kf__row" style={{ gap: 4, margin: 0 }}>
            <span>Duración</span>
            <input
              type="number"
              className="char-lib__url"
              style={{ width: 64, flex: "0 0 auto" }}
              min={10}
              max={300}
              value={musicDur}
              onChange={(e) => setMusicDur(Number(e.target.value))}
            />
            <span>s</span>
          </label>
        </div>
        <div className="kf__actions">
          <button disabled={musicPrompt.trim().length < 10} onClick={generateMusic}>
            Generar música
          </button>
          <span className="muted small">cada generación crea una opción nueva</span>
        </div>

        {musicTracks.length > 0 ? (
          <div className="music-list">
            {musicTracks.map((t) => {
              const active = t.id === activeMusicId;
              return (
                <div
                  className={`music-item ${active ? "music-item--active" : ""}`}
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/track-id", t.id)}
                  title="Arrastra al carril de música del editor, o pulsa «Usar»"
                >
                  <IconGripVertical size={14} className="music-item__grip" />
                  <span className="music-item__name">{t.label}</span>
                  <JobBadge job={t.job} etaSec={40} />
                  {t.job?.status === "rendering" || t.job?.status === "queued" ? (
                    <div className="queue music-item__queue">
                      <div className="queue__bar" style={{ width: `${t.job.progress}%` }} />
                    </div>
                  ) : null}
                  {t.url ? <audio src={t.url} controls className="audio-player music-item__audio" /> : null}
                  {t.url ? (
                    active ? (
                      <span className="music-item__active"><IconCheck size={13} /> en montaje</span>
                    ) : (
                      <button className="mini" onClick={() => useMusic(t.id)}>Usar</button>
                    )
                  ) : null}
                  <button
                    className="icon-btn"
                    title="Eliminar esta opción"
                    onClick={() => deleteMusic(t.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                  {t.job?.status === "failed" && t.job.error ? (
                    <span className="muted small" style={{ color: "var(--err, #d05656)" }}>{t.job.error}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
