import { useEffect, useState } from "react";
import { IconMovie, IconWand } from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { useActiveBlock } from "@/state/ActiveBlock";
import { config } from "@/config";
import { storeAssetBlob } from "@/state/assets";
import { AudioSection } from "./AudioSection";
import { Timeline } from "./TimelineEditor";
import { ensureTimeline, readyShots } from "./timeline";

/** Montaje: timeline (clips + audio) and the two assembly paths. */
export function EditorPage() {
  const store = useStore();
  const { project, update } = store;
  const block = useActiveBlock();
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);
  const [rendering, setRendering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ready = readyShots(project);
  const audioWithUrl = (project.audio ?? []).filter((t) => t.url);

  // Keep the timeline in sync with produced clips / generated audio.
  useEffect(() => {
    update((d) => ensureTimeline(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.length, audioWithUrl.length]);

  useEffect(() => {
    fetch(`${config.directorBase}/capabilities`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setFfmpeg(!!d.ffmpeg))
      .catch(() => setFfmpeg(false));
  }, []);

  const edit = project.edit ?? { clips: [], audio: [] };
  const shotOf = (id: string) => project.shots.find((s) => s.id === id);
  const trackOf = (id: string) => (project.audio ?? []).find((t) => t.id === id);
  const includedClips = [...edit.clips].sort((a, b) => a.order - b.order).filter((c) => c.included);

  /** Real render with ffmpeg: trim + concat + voice/music mux. */
  const renderWithAudio = async () => {
    if (includedClips.length === 0) {
      setMsg("Incluye al menos un clip en el timeline.");
      return;
    }
    setRendering(true);
    setMsg(null);
    update((d) => {
      d.delivery.finalVideoJob = {
        id: d.delivery.finalVideoJob?.id ?? `render_${Date.now()}`,
        kind: "concat",
        status: "rendering",
        mode: "mcp_default",
        transportLabel: "ffmpeg (local)",
        progress: 30,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    try {
      // Local-first: the clip/audio bytes live on the user's machine (blob:
      // URLs), so upload each input to the server's EPHEMERAL /tmp workspace,
      // render there, and receive the mp4 back in the response — the server
      // stores nothing.
      const rid = Math.random().toString(36).slice(2, 14);
      const uploaded = new Map<string, string>(); // srcUrl -> uploaded name
      const uploadInput = async (srcUrl: string, name: string) => {
        const prev = uploaded.get(srcUrl);
        if (prev) return prev;
        const blob = await (await fetch(srcUrl)).blob();
        const r = await fetch(
          `${config.directorBase}/render-input?render=${rid}&name=${encodeURIComponent(name)}`,
          { method: "POST", credentials: "include", body: blob },
        );
        const d = (await r.json()) as { ok: boolean; error?: string };
        if (!d.ok) throw new Error(d.error ?? "No se pudo subir un clip");
        uploaded.set(srcUrl, name);
        return name;
      };

      const clips = [];
      for (let i = 0; i < includedClips.length; i++) {
        const c = includedClips[i];
        const u = shotOf(c.shotId)?.videoUrl;
        if (!u) continue;
        clips.push({
          file: await uploadInput(u, `clip${i}.mp4`),
          inSec: c.inSec,
          outSec: c.outSec,
          mute: !!c.muted,
        });
      }
      const audio = [];
      const placements = edit.audio.filter((p) => !p.muted);
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const t = trackOf(p.trackId);
        if (!t?.url) continue;
        audio.push({
          file: await uploadInput(t.url, `audio${i}.mp3`),
          offsetSec: p.offsetSec,
          volume: p.volume,
          inSec: p.inSec,
          outSec: p.outSec,
        });
      }

      const res = await fetch(`${config.directorBase}/render`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ render: rid, muteVideo: !!edit.muteVideo, clips, audio }),
      });
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("video/")) {
        const data = (await res.json()) as { ok: boolean; error?: string };
        throw new Error(data.error ?? "Falló el render");
      }
      // Store the final video on the user's machine like any other asset.
      const finalUrl = await storeAssetBlob(`final_${rid}`, await res.blob(), ".mp4");
      update((d) => {
        d.delivery.finalVideoUrl = finalUrl;
        if (d.delivery.finalVideoJob) {
          d.delivery.finalVideoJob.status = "ready";
          d.delivery.finalVideoJob.progress = 100;
          d.delivery.finalVideoJob.resultUrl = finalUrl;
          d.delivery.finalVideoJob.updatedAt = Date.now();
        }
        if (d.gates.delivery === "in_progress") d.gates.delivery = "ready";
      });
      setMsg("Vídeo final renderizado con audio. Míralo en la pestaña Entrega.");
    } catch (e) {
      update((d) => {
        if (d.delivery.finalVideoJob) {
          d.delivery.finalVideoJob.status = "failed";
          d.delivery.finalVideoJob.error = e instanceof Error ? e.message : String(e);
          d.delivery.finalVideoJob.updatedAt = Date.now();
        }
      });
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  };

  const quickAssemble = async () => {
    const action = block.getActions().find((a) => a.id === "assemble_final");
    if (!action) return;
    setMsg("Ensamblando con Magnific (sin audio externo)…");
    await action.run();
    setMsg("Ensamblaje rápido listo. Míralo en la pestaña Entrega.");
  };

  if (ready.length === 0) {
    return (
      <p className="onboard">
        Aún no hay vídeos producidos. Genera y valida planos en <b>Producción</b> para
        montarlos aquí.
      </p>
    );
  }

  return (
    <div className="editor">
      <div className="editor__bar">
        <button
          className="action action--gen"
          disabled={rendering || ffmpeg === false}
          title={ffmpeg === false ? "Instala ffmpeg en el servidor (brew install ffmpeg)" : undefined}
          onClick={renderWithAudio}
        >
          {rendering ? <span className="spin" /> : <IconWand size={16} />} Ensamblar con audio
        </button>
        <button className="action" disabled={rendering} onClick={quickAssemble}>
          <IconMovie size={16} /> Ensamblaje rápido
        </button>
        {ffmpeg === false ? (
          <span className="muted small">
            Para “Ensamblar con audio”: <code>brew install ffmpeg</code> y reinicia el backend.
          </span>
        ) : null}
      </div>
      {msg ? <p className="muted small">{msg}</p> : null}

      <Timeline />

      <h3 className="editor__subtitle">Generar audio</h3>
      <AudioSection />
    </div>
  );
}
