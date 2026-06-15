import { useEffect, useRef, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCut,
  IconEye,
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { useStore } from "@/state/ProjectStore";
import { uid } from "@/state/seed";
import { DEFAULT_VOLUME } from "./timeline";

/**
 * Visual timeline editor: time-proportional clips with drag-to-trim handles, a
 * playhead spanning all lanes (scrub + split at the cut), real-time frame
 * preview with its own transport, multi-track playback, mute toggles, and
 * per-clip filmstrips sampled from the actual video. A simple editor, not an NLE.
 */

const PPS = 70; // pixels per second
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
};
const round = (n: number) => Math.round(n * 10) / 10;

/** Sample N frames from a video into a single horizontal filmstrip data URL. */
function buildFilmstrip(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.src = url;
    const fw = 160;
    const fh = 90;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | null;
    let times: number[] = [];
    let i = 0;
    const next = () => {
      if (i >= times.length) {
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } catch (e) {
          reject(e);
        }
        return;
      }
      try {
        v.currentTime = times[i];
      } catch {
        reject(new Error("seek"));
      }
    };
    v.onloadeddata = () => {
      const dur = v.duration || 4;
      const n = Math.min(12, Math.max(3, Math.round(dur / 1.5)));
      canvas = document.createElement("canvas");
      canvas.width = fw * n;
      canvas.height = fh;
      ctx = canvas.getContext("2d");
      times = Array.from({ length: n }, (_, k) => (dur * (k + 0.5)) / n);
      v.play().then(() => { v.pause(); next(); }).catch(next);
    };
    v.onseeked = () => {
      try {
        ctx?.drawImage(v, i * fw, 0, fw, fh);
      } catch {
        /* ignore a frame */
      }
      i += 1;
      next();
    };
    v.onerror = () => reject(new Error("filmstrip load"));
  });
}

type DragKind = "clip-in" | "clip-out" | "audio-in" | "audio-out" | "audio-move";
interface Drag {
  kind: DragKind;
  id: string;
  startX: number;
  base: number;
  val: number;
  min: number;
  max: number;
}

export function Timeline() {
  const store = useStore();
  const { project, update } = store;
  const previewRef = useRef<HTMLVideoElement>(null);
  const audioEls = useRef<Record<string, HTMLAudioElement | null>>({});
  const raf = useRef<number | null>(null);
  const playIdx = useRef(0);
  const barScrub = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const fsBusy = useRef(false);
  const [filmstrips, setFilmstrips] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [audioDur, setAudioDur] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<{ type: "clip" | "audio"; id: string } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewLabel, setPreviewLabel] = useState("");
  const [loadingPrev, setLoadingPrev] = useState(false);

  const edit = project.edit ?? { clips: [], audio: [], muteVideo: false };
  const muteVideo = !!edit.muteVideo;
  // Live refs so the rAF playback loop always reads the CURRENT mute/volume/clip
  // state instead of the closure captured when play() started.
  const muteVideoRef = useRef(muteVideo);
  muteVideoRef.current = muteVideo;
  const editRef = useRef(edit);
  editRef.current = edit;
  const clips = [...edit.clips].sort((a, b) => a.order - b.order);
  const shotOf = (id: string) => project.shots.find((s) => s.id === id);
  const trackOf = (id: string) => (project.audio ?? []).find((t) => t.id === id);
  const sceneNum = (id: string) => project.scenes.find((s) => s.id === id)?.number ?? 0;

  // Probe real media durations (fall back to nominal).
  const clipKey = clips.map((c) => c.shotId).join(",");
  useEffect(() => {
    for (const c of clips) {
      const s = shotOf(c.shotId);
      if (!s?.videoUrl || durations[c.shotId] != null) continue;
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = s.videoUrl;
      v.onloadedmetadata = () => setDurations((d) => ({ ...d, [c.shotId]: v.duration || s.videoDurationSec || 4 }));
      v.onerror = () => setDurations((d) => ({ ...d, [c.shotId]: s.videoDurationSec || 4 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey]);

  // Build a filmstrip per shot from the actual video (sequential to limit load).
  useEffect(() => {
    if (fsBusy.current) return;
    const pending = [...new Set(clips.map((c) => c.shotId))].filter(
      (id) => !filmstrips[id] && shotOf(id)?.videoUrl,
    );
    if (pending.length === 0) return;
    fsBusy.current = true;
    void (async () => {
      for (const id of pending) {
        const url = shotOf(id)?.videoUrl;
        if (!url) continue;
        try {
          const strip = await buildFilmstrip(url);
          setFilmstrips((f) => ({ ...f, [id]: strip }));
        } catch {
          /* keep keyframe fallback for this one */
        }
      }
      fsBusy.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, filmstrips]);

  const audioKey = edit.audio.map((a) => a.trackId).join(",");
  useEffect(() => {
    for (const p of edit.audio) {
      const t = trackOf(p.trackId);
      if (!t?.url || audioDur[p.trackId] != null) continue;
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.src = t.url;
      a.onloadedmetadata = () => setAudioDur((d) => ({ ...d, [p.trackId]: a.duration || 10 }));
      a.onerror = () => setAudioDur((d) => ({ ...d, [p.trackId]: 10 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey]);

  const clipDur = (shotId: string) => durations[shotId] ?? shotOf(shotId)?.videoDurationSec ?? 4;
  const trackDur = (trackId: string) => audioDur[trackId] ?? 10;

  // COMMITTED values (layout never reflows during a drag — applied on release).
  const cIn0 = (c: (typeof clips)[number]) => c.inSec ?? 0;
  const cOut0 = (c: (typeof clips)[number]) => c.outSec ?? clipDur(c.shotId);
  const cLen0 = (c: (typeof clips)[number]) => Math.max(0.1, cOut0(c) - cIn0(c));

  const included = clips.filter((c) => c.included);
  const seq: { c: (typeof clips)[number]; start: number; len: number }[] = [];
  let cursor = 0;
  for (const c of included) {
    const len = cLen0(c);
    seq.push({ c, start: cursor, len });
    cursor += len;
  }
  const totalDur = cursor;

  // Audio is live during drag (its lane never reflows others).
  const dv = (kind: DragKind, id: string) =>
    drag && drag.kind === kind && drag.id === id ? drag.val : undefined;
  const trackLen = (p: (typeof edit.audio)[number]) => (p.outSec ?? trackDur(p.trackId)) - (p.inSec ?? 0);

  // --- Frame preview (static seek) ---
  const previewClip = (shotId: string, t: number) => {
    const v = previewRef.current;
    const s = shotOf(shotId);
    const url = s?.videoUrl;
    if (!v || !url) return;
    const seek = () => {
      try {
        v.currentTime = Math.max(0, t);
      } catch {
        /* not seekable yet */
      }
    };
    if (v.dataset.url !== url) {
      v.dataset.url = url;
      v.muted = muteVideo;
      v.src = url;
      v.load();
      v.addEventListener(
        "loadeddata",
        () => v.play().then(() => { v.pause(); seek(); }).catch(seek),
        { once: true },
      );
    } else if (!playing) {
      if (v.readyState >= 2) seek();
      else v.addEventListener("loadeddata", seek, { once: true });
    }
    if (s) setPreviewLabel(`E${sceneNum(s.sceneId)}·P${s.order} · ${fmtTime(t)}`);
  };

  const previewSequence = (globalT: number) => {
    const at = seq.find((x) => globalT < x.start + x.len) ?? seq[seq.length - 1];
    if (at) previewClip(at.c.shotId, cIn0(at.c) + Math.max(0, globalT - at.start));
  };

  // --- Drag wiring (trim handles + audio move) ---
  const startDrag = (e: React.PointerEvent, kind: DragKind, id: string, base: number, min: number, max: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (playing) stop();
    setDrag({ kind, id, startX: e.clientX, base, val: base, min, max });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const delta = (e.clientX - drag.startX) / PPS;
      const val = Math.min(drag.max, Math.max(drag.min, drag.base + delta));
      setDrag((d) => (d ? { ...d, val } : d));
    };
    const onUp = () => {
      const d = drag;
      setDrag(null);
      if (!d) return;
      update((proj) => {
        if (d.kind === "clip-in" || d.kind === "clip-out") {
          const c = proj.edit?.clips.find((x) => x.id === d.id);
          if (c) (d.kind === "clip-in" ? (c.inSec = round(d.val)) : (c.outSec = round(d.val)));
        } else {
          const p = proj.edit?.audio.find((x) => x.trackId === d.id);
          if (p) {
            if (d.kind === "audio-in") p.inSec = round(d.val);
            else if (d.kind === "audio-out") p.outSec = round(d.val);
            else if (d.kind === "audio-move") p.offsetSec = round(d.val);
          }
        }
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  // Live frame preview while dragging a clip handle (without reflowing layout).
  useEffect(() => {
    if (!drag || (drag.kind !== "clip-in" && drag.kind !== "clip-out")) return;
    const c = clips.find((x) => x.id === drag.id);
    if (c) previewClip(c.shotId, drag.val);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.val]);

  const startClipHandle = (e: React.PointerEvent, c: (typeof clips)[number], edge: "in" | "out") =>
    edge === "in"
      ? startDrag(e, "clip-in", c.id, cIn0(c), 0, cOut0(c) - 0.2)
      : startDrag(e, "clip-out", c.id, cOut0(c), cIn0(c) + 0.2, clipDur(c.shotId));

  // --- Playback (multi-track) ---
  const stop = () => {
    setPlaying(false);
    setLoadingPrev(false);
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    previewRef.current?.pause();
    Object.values(audioEls.current).forEach((a) => a?.pause());
  };

  const startClipAt = (idx: number) => {
    const v = previewRef.current;
    const item = seq[idx];
    if (!v || !item) return stop();
    playIdx.current = idx;
    const url = shotOf(item.c.shotId)?.videoUrl;
    if (!url) return;
    v.muted = muteVideo || !!item.c.muted;
    const seekTo = cIn0(item.c);
    const onReady = () => {
      try { v.currentTime = seekTo; } catch { /* ignore */ }
    };
    if (v.dataset.url !== url) {
      v.dataset.url = url;
      v.src = url;
      v.addEventListener("loadedmetadata", onReady, { once: true });
    } else {
      onReady();
    }
    // play() MUST be called synchronously (within the click gesture) — a deferred
    // play() on an unmuted video is blocked by the browser's autoplay policy.
    void v.play().catch(() => {});
  };

  const play = () => {
    if (seq.length === 0) return;
    setPlaying(true);
    const at = seq.findIndex((x) => playhead < x.start + x.len);
    startClipAt(at < 0 ? 0 : at);
    // Activate the audio elements WITHIN the click gesture (muted play→pause) so
    // their later unmuted play() in the loop isn't blocked by the autoplay policy.
    for (const el of Object.values(audioEls.current)) {
      if (!el) continue;
      el.muted = true;
      el.play().then(() => el.pause()).catch(() => {});
    }
    const tick = () => {
      const v = previewRef.current;
      const item = seq[playIdx.current];
      if (!v || !item) return stop();
      // Apply mute live (global toggle + this clip's per-clip mute).
      const liveClip = editRef.current.clips.find((c) => c.id === item.c.id);
      v.muted = muteVideoRef.current || !!liveClip?.muted;
      const global = item.start + Math.max(0, v.currentTime - cIn0(item.c));
      setPlayhead(global);
      // Audio only runs while the VIDEO is genuinely playing (not paused, not
      // seeking, enough data buffered). Otherwise music/voz would run ahead while
      // the preview is still loading — so we pause all audio until the video does.
      const videoPlaying = !v.paused && !v.seeking && v.readyState >= 3;
      for (const p of editRef.current.audio) {
        const el = audioEls.current[p.trackId];
        if (!el) continue;
        const len = (p.outSec ?? trackDur(p.trackId)) - (p.inSec ?? 0);
        const inWindow = global >= p.offsetSec && global < p.offsetSec + len;
        if (videoPlaying && inWindow && !p.muted) {
          // Don't touch it until it's actually buffered too.
          if (el.readyState < 2) continue;
          el.muted = false;
          el.volume = Math.min(1, Math.max(0, p.volume));
          const want = (p.inSec ?? 0) + (global - p.offsetSec);
          if (el.paused) {
            try { el.currentTime = want; } catch { /* ignore */ }
            void el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - want) > 0.35) {
            try { el.currentTime = want; } catch { /* ignore */ }
          }
        } else if (!el.paused) el.pause();
      }
      // Only advance when the clip is actually playing (loaded + not seeking),
      // otherwise a stale currentTime cascades through every clip (the "loop").
      if (v.readyState >= 2 && !v.seeking && v.currentTime >= cOut0(item.c) - 0.05) {
        if (playIdx.current + 1 < seq.length) startClipAt(playIdx.current + 1);
        else { stop(); setPlayhead(0); return; }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []); // cleanup on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Jump to a time WHILE playing: reposition the video (load the right clip if we
  // crossed into another) and keep playing — never pause on a seek.
  const seekPlaybackTo = (t: number) => {
    const v = previewRef.current;
    if (!v) return;
    const idx = seq.findIndex((x) => t < x.start + x.len);
    const i = idx < 0 ? seq.length - 1 : idx;
    const item = seq[i];
    if (!item) return;
    const url = shotOf(item.c.shotId)?.videoUrl;
    if (!url) return;
    const local = cIn0(item.c) + Math.max(0, t - item.start);
    if (playIdx.current !== i || v.dataset.url !== url) {
      playIdx.current = i;
      v.muted = muteVideoRef.current || !!item.c.muted;
      if (v.dataset.url !== url) {
        v.dataset.url = url;
        v.src = url;
        v.addEventListener("loadedmetadata", () => { try { v.currentTime = local; } catch { /* ignore */ } }, { once: true });
      } else {
        try { v.currentTime = local; } catch { /* ignore */ }
      }
      void v.play().catch(() => {});
    } else {
      try { v.currentTime = local; } catch { /* ignore */ }
    }
  };

  // Move the playhead to a time: keep playing if we were (seek), else preview.
  const goTo = (t: number) => {
    setPlayhead(t);
    if (playing) seekPlaybackTo(t);
    else previewSequence(t);
  };

  // Scrub via the preview progress bar.
  const scrubBar = (clientX: number, el: HTMLDivElement) => {
    if (totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(totalDur, Math.max(0, ((clientX - rect.left) / rect.width) * totalDur));
    goTo(t);
  };

  // Scrub the playhead on the timeline (ruler, gaps, or grabbing the pink line),
  // following the cursor while held and previewing live.
  const doScrub = (clientX: number) => {
    const el = contentRef.current;
    if (!el || totalDur <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(totalDur, Math.max(0, (clientX - rect.left) / PPS));
    goTo(t);
  };
  // Keep a live ref so the global listeners always use the current closure.
  const doScrubRef = useRef(doScrub);
  doScrubRef.current = doScrub;
  // Release ANYWHERE on screen fixes the playhead where it is (window-level, so
  // it never gets "stuck" when the pointer leaves the timeline).
  useEffect(() => {
    const move = (e: PointerEvent) => { if (scrubbing.current) doScrubRef.current(e.clientX); };
    const up = () => { scrubbing.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // --- Mutations ---
  const moveClip = (id: string, dir: -1 | 1) =>
    update((d) => {
      const list = (d.edit?.clips ?? []).sort((a, b) => a.order - b.order);
      const i = list.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((c, k) => (c.order = k));
    });
  const toggleClip = (id: string) =>
    update((d) => {
      const c = d.edit?.clips.find((x) => x.id === id);
      if (c) c.included = !c.included;
    });
  const toggleClipMute = (id: string) =>
    update((d) => {
      const c = d.edit?.clips.find((x) => x.id === id);
      if (c) c.muted = !c.muted;
    });
  // Swap which generated music track is active on the timeline.
  const setActiveMusic = (trackId: string) =>
    update((d) => {
      d.edit = d.edit ?? { clips: [], audio: [] };
      const ids = new Set((d.audio ?? []).filter((t) => t.kind === "music").map((t) => t.id));
      const ex = d.edit.audio.find((p) => ids.has(p.trackId));
      if (ex) ex.trackId = trackId;
      else d.edit.audio.push({ trackId, offsetSec: 0, volume: DEFAULT_VOLUME.music });
    });
  const musicTracks = (project.audio ?? []).filter((t) => t.kind === "music" && t.url);
  const cycleMusic = (currentId: string) => {
    if (musicTracks.length < 2) return;
    const i = musicTracks.findIndex((t) => t.id === currentId);
    const next = musicTracks[(i + 1) % musicTracks.length];
    if (next) setActiveMusic(next.id);
  };
  const setVolume = (trackId: string, v: number) =>
    update((d) => {
      const p = d.edit?.audio.find((x) => x.trackId === trackId);
      if (p) p.volume = v;
    });
  const toggleTrackMute = (trackId: string) =>
    update((d) => {
      const p = d.edit?.audio.find((x) => x.trackId === trackId);
      if (p) p.muted = !p.muted;
    });
  const toggleVideoMute = () =>
    update((d) => {
      d.edit = d.edit ?? { clips: [], audio: [] };
      d.edit.muteVideo = !d.edit.muteVideo;
    });

  const splitAtPlayhead = () => {
    const item = seq.find((x) => playhead > x.start + 0.1 && playhead < x.start + x.len - 0.1);
    if (!item) return;
    const localCut = round(cIn0(item.c) + (playhead - item.start));
    const origOut = round(cOut0(item.c));
    if (playing) stop();
    update((d) => {
      const orig = d.edit?.clips.find((x) => x.id === item.c.id);
      if (!orig || !d.edit) return;
      orig.outSec = localCut;
      d.edit.clips.push({
        id: uid("clip"),
        shotId: orig.shotId,
        order: orig.order + 0.5,
        included: true,
        inSec: localCut,
        outSec: origOut,
      });
      d.edit.clips.sort((a, b) => a.order - b.order).forEach((x, i) => (x.order = i));
    });
  };

  const contentW = Math.max(
    320,
    totalDur * PPS,
    ...edit.audio.map((p) => ((dv("audio-move", p.trackId) ?? p.offsetSec) + trackLen(p)) * PPS),
  );
  const canSplit = !!seq.find((x) => playhead > x.start + 0.1 && playhead < x.start + x.len - 0.1);
  const excluded = clips.filter((c) => !c.included);

  // Guide overlay while trimming a video clip (no reflow).
  let guide: { x: number; shadeL: number; shadeW: number; added: boolean } | null = null;
  if (drag && (drag.kind === "clip-in" || drag.kind === "clip-out")) {
    const item = seq.find((x) => x.c.id === drag.id);
    if (item) {
      const x = (item.start + (drag.val - cIn0(item.c))) * PPS;
      const edge = drag.kind === "clip-in" ? item.start * PPS : (item.start + item.len) * PPS;
      const added = drag.kind === "clip-in" ? drag.val < cIn0(item.c) : drag.val > cOut0(item.c);
      guide = { x, shadeL: Math.min(x, edge), shadeW: Math.abs(x - edge), added };
    }
  }

  return (
    <div className="tl">
      <div className="tl__toolbar">
        <button className="mini" onClick={splitAtPlayhead} disabled={!canSplit} title="Cortar el clip en la cabeza lectora">
          <IconCut size={15} /> Cortar aquí
        </button>
        <button className={`mini ${muteVideo ? "is-on" : ""}`} onClick={toggleVideoMute} title="Silenciar el audio nativo de los vídeos">
          {muteVideo ? <IconVolumeOff size={15} /> : <IconVolume size={15} />} Vídeo {muteVideo ? "silenciado" : "con audio"}
        </button>
      </div>

      <div className="tl__preview">
        <video
          ref={previewRef}
          playsInline
          onWaiting={() => setLoadingPrev(true)}
          onSeeking={() => setLoadingPrev(true)}
          onStalled={() => setLoadingPrev(true)}
          onPlaying={() => setLoadingPrev(false)}
          onSeeked={() => setLoadingPrev(false)}
          onCanPlay={() => setLoadingPrev(false)}
        />
        <span className="tl__previewlabel">{previewLabel || "Pulsa play o mueve la cabeza lectora"}</span>
        {loadingPrev ? (
          <span className="tl__ploading"><span className="spin" /> cargando…</span>
        ) : null}
        <div className="tl__pcontrols">
          <button className="tl__pbtn" onClick={() => (playing ? stop() : play())} disabled={seq.length === 0}>
            {playing ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
          </button>
          <div
            className="tl__pbar"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); barScrub.current = true; scrubBar(e.clientX, e.currentTarget); }}
            onPointerMove={(e) => { if (barScrub.current) scrubBar(e.clientX, e.currentTarget); }}
            onPointerUp={() => { barScrub.current = false; }}
          >
            <div className="tl__pfill" style={{ width: totalDur ? `${(playhead / totalDur) * 100}%` : "0%" }} />
          </div>
          <span className="tl__ptime">{fmtTime(playhead)} / {fmtTime(totalDur)}</span>
        </div>
      </div>

      <div className="tl__scroll">
        <div
          className="tl__content"
          ref={contentRef}
          style={{ width: contentW }}
          onPointerDown={(e) => {
            const tgt = e.target as HTMLElement;
            // Let clips, handles, audio blocks and buttons keep their own gestures.
            if (tgt.closest(".tl__clip, .tl__aclip, .tl__handle, button")) return;
            scrubbing.current = true;
            doScrub(e.clientX);
          }}
        >
          <div className="tl__ruler">
            {Array.from({ length: Math.ceil(totalDur) + 1 }).map((_, i) => (
              <span className="tl__tick" key={i} style={{ left: i * PPS }}>{i}s</span>
            ))}
          </div>

          <div className="tl__lane">
            {seq.map(({ c, start, len }, idx) => {
              const s = shotOf(c.shotId);
              if (!s) return null;
              const sel = selected?.type === "clip" && selected.id === c.id;
              const fs = filmstrips[c.shotId];
              const dur = clipDur(c.shotId);
              const bg = fs
                ? { backgroundImage: `url(${fs})`, backgroundSize: `${dur * PPS}px 100%`, backgroundPositionX: `${-cIn0(c) * PPS}px`, backgroundRepeat: "no-repeat" as const }
                : s.keyframeUrl
                  ? { backgroundImage: `url(${s.keyframeUrl})`, backgroundSize: "cover" as const }
                  : undefined;
              return (
                <div
                  className={`tl__clip ${sel ? "tl__clip--sel" : ""}`}
                  key={c.id}
                  style={{ left: start * PPS, width: len * PPS }}
                  onPointerDown={() => setSelected({ type: "clip", id: c.id })}
                >
                  <span className="tl__handle tl__handle--l" title="Recortar inicio" onPointerDown={(e) => startClipHandle(e, c, "in")} />
                  <div className="tl__clipbody" style={bg}>
                    <span className="tl__cliptag">E{sceneNum(s.sceneId)}·P{s.order}</span>
                    <span className="tl__cliplen">{len.toFixed(1)}s</span>
                    <div className="tl__cliporder">
                      <button disabled={idx === 0} onClick={() => moveClip(c.id, -1)} title="Antes"><IconChevronLeft size={13} /></button>
                      <button onClick={() => toggleClip(c.id)} title="Excluir"><IconEye size={13} /></button>
                      <button
                        className={muteVideo || c.muted ? "is-on" : ""}
                        onClick={() => toggleClipMute(c.id)}
                        title={c.muted ? "Activar audio del clip" : "Silenciar audio del clip"}
                      >
                        {muteVideo || c.muted ? <IconVolumeOff size={13} /> : <IconVolume size={13} />}
                      </button>
                      <button disabled={idx === seq.length - 1} onClick={() => moveClip(c.id, 1)} title="Después"><IconChevronRight size={13} /></button>
                    </div>
                  </div>
                  <span className="tl__handle tl__handle--r" title="Recortar final" onPointerDown={(e) => startClipHandle(e, c, "out")} />
                </div>
              );
            })}
            {guide ? (
              <>
                <div className={`tl__guideshade ${guide.added ? "tl__guideshade--add" : ""}`} style={{ left: guide.shadeL, width: guide.shadeW }} />
                <div className="tl__guide" style={{ left: guide.x }}>
                  <span className="tl__guidelabel">{fmtTime(drag!.val)}</span>
                </div>
              </>
            ) : null}
          </div>

          {edit.audio.map((p) => {
            const t = trackOf(p.trackId);
            if (!t) return null;
            const offset = dv("audio-move", p.trackId) ?? p.offsetSec;
            const aIn = dv("audio-in", p.trackId) ?? p.inSec ?? 0;
            const aOut = dv("audio-out", p.trackId) ?? p.outSec ?? trackDur(p.trackId);
            const len = Math.max(0.3, aOut - aIn);
            const sel = selected?.type === "audio" && selected.id === p.trackId;
            const isMusic = t.kind === "music";
            return (
              <div
                className="tl__lane tl__lane--audio"
                key={p.trackId}
                onDragOver={isMusic ? (e) => e.preventDefault() : undefined}
                onDrop={
                  isMusic
                    ? (e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/track-id");
                        if (id) setActiveMusic(id);
                      }
                    : undefined
                }
              >
                <div
                  className={`tl__aclip tl__aclip--${t.kind} ${sel ? "tl__clip--sel" : ""} ${p.muted ? "tl__aclip--muted" : ""}`}
                  style={{ left: offset * PPS, width: len * PPS }}
                  onPointerDown={(e) => startDrag(e, "audio-move", p.trackId, p.offsetSec, 0, Math.max(0, totalDur - len))}
                  onClick={() => setSelected({ type: "audio", id: p.trackId })}
                >
                  <span className="tl__handle tl__handle--l" title="Recortar inicio" onPointerDown={(e) => startDrag(e, "audio-in", p.trackId, aIn, 0, aOut - 0.2)} />
                  <button
                    className="tl__amute"
                    title={p.muted ? "Activar pista" : "Silenciar pista"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggleTrackMute(p.trackId); }}
                  >
                    {p.muted ? <IconVolumeOff size={12} /> : <IconVolume size={12} />}
                  </button>
                  <span className="tl__aname">{t.label}</span>
                  {isMusic && musicTracks.length >= 2 ? (
                    <button
                      className="tl__amute"
                      title="Cambiar a otra música generada"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); cycleMusic(p.trackId); }}
                    >
                      <IconChevronRight size={12} />
                    </button>
                  ) : null}
                  <span className="tl__handle tl__handle--r" title="Recortar final" onPointerDown={(e) => startDrag(e, "audio-out", p.trackId, aOut, aIn + 0.2, trackDur(p.trackId))} />
                </div>
              </div>
            );
          })}

          <div className="tl__playhead" style={{ left: playhead * PPS }} />
        </div>
      </div>

      {excluded.length > 0 ? (
        <div className="tl__excluded">
          <span className="muted small">Excluidos:</span>
          {excluded.map((c) => {
            const s = shotOf(c.shotId);
            return s ? (
              <button key={c.id} className="tl__chip" title="Incluir de nuevo" onClick={() => toggleClip(c.id)}>
                <IconVolumeOff size={12} /> E{sceneNum(s.sceneId)}·P{s.order}
              </button>
            ) : null;
          })}
        </div>
      ) : null}

      {/* Hidden audio elements for playback */}
      {edit.audio.map((p) => {
        const t = trackOf(p.trackId);
        return t?.url ? (
          <audio key={p.trackId} src={t.url} preload="auto" ref={(el) => (audioEls.current[p.trackId] = el)} />
        ) : null;
      })}

      {selected ? (
        <div className="tl__inspector">
          {selected.type === "clip"
            ? (() => {
                const c = clips.find((x) => x.id === selected.id);
                const s = c && shotOf(c.shotId);
                if (!c || !s) return null;
                return (
                  <>
                    <b>E{sceneNum(s.sceneId)}·P{s.order}</b>
                    <span>inicio {(c.inSec ?? 0).toFixed(1)}s</span>
                    <span>fin {(c.outSec ?? clipDur(c.shotId)).toFixed(1)}s</span>
                    <span>dura {cLen0(c).toFixed(1)}s</span>
                    <button className="mini" onClick={() => update((d) => { const x = d.edit?.clips.find((y) => y.id === c.id); if (x) { x.inSec = undefined; x.outSec = undefined; } })}>Quitar recorte</button>
                  </>
                );
              })()
            : (() => {
                const p = edit.audio.find((x) => x.trackId === selected.id);
                const t = p && trackOf(p.trackId);
                if (!p || !t) return null;
                return (
                  <>
                    <b>{t.label}</b>
                    <label className="tl__vol">vol
                      <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => setVolume(p.trackId, Number(e.target.value))} />
                      <span>{Math.round(p.volume * 100)}%</span>
                    </label>
                    <button className={`mini ${p.muted ? "is-on" : ""}`} onClick={() => toggleTrackMute(p.trackId)}>
                      {p.muted ? "Silenciada" : "Silenciar"}
                    </button>
                    <span>offset {p.offsetSec.toFixed(1)}s</span>
                  </>
                );
              })()}
        </div>
      ) : null}
    </div>
  );
}
