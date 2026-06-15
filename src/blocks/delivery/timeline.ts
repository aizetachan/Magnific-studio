import type { AudioTrack, Project, Shot } from "@/types/project";
import { uid } from "@/state/seed";

/** Default mix levels: voice up front, music as a bed underneath. */
export const DEFAULT_VOLUME: Record<AudioTrack["kind"], number> = {
  voice: 1,
  music: 0.35,
};

/** Produced clips that can go on the timeline (have a real video), in order. */
export function readyShots(project: Project): Shot[] {
  const sceneNum = (id: string) => project.scenes.find((s) => s.id === id)?.number ?? 0;
  return project.shots
    .filter((s) => s.videoJob?.status === "ready" && !!s.videoUrl)
    .sort((a, b) => sceneNum(a.sceneId) - sceneNum(b.sceneId) || a.order - b.order);
}

/**
 * Keep project.edit in sync with what's been produced: add clips/audio that are
 * new, drop ones whose source disappeared, and keep a contiguous clip order.
 * Mutates the draft (call inside store.update).
 */
export function ensureTimeline(d: Project): void {
  d.edit = d.edit ?? { clips: [], audio: [] };
  const shots = readyShots(d);
  const shotIds = new Set(shots.map((s) => s.id));

  // Migrate older entries that predate clip ids.
  for (const c of d.edit.clips) if (!c.id) c.id = uid("clip");
  // Drop clips whose shot is no longer ready; add new ready shots at the end.
  d.edit.clips = d.edit.clips.filter((c) => shotIds.has(c.shotId));
  const present = new Set(d.edit.clips.map((c) => c.shotId));
  for (const s of shots) {
    if (!present.has(s.id)) {
      d.edit.clips.push({ id: uid("clip"), shotId: s.id, order: d.edit.clips.length, included: true });
    }
  }
  d.edit.clips.sort((a, b) => a.order - b.order).forEach((c, i) => (c.order = i));

  // Sync audio placements with generated tracks.
  const tracks = d.audio ?? [];
  const trackIds = new Set(tracks.filter((t) => t.url).map((t) => t.id));
  d.edit.audio = d.edit.audio.filter((p) => trackIds.has(p.trackId));
  const placed = new Set(d.edit.audio.map((p) => p.trackId));

  // Voiceovers: one placement per generated scene voice.
  for (const t of tracks) {
    if (t.kind === "voice" && t.url && !placed.has(t.id)) {
      d.edit.audio.push({ trackId: t.id, offsetSec: 0, volume: DEFAULT_VOLUME.voice });
    }
  }

  // Music: only ONE active track on the timeline (others stay as options the
  // user can swap in via drag or the editor chevron). Auto-place the latest if
  // none is active yet.
  const musicTracks = tracks.filter((t) => t.kind === "music" && t.url);
  const hasActiveMusic = d.edit.audio.some((p) => musicTracks.some((m) => m.id === p.trackId));
  if (!hasActiveMusic && musicTracks.length > 0) {
    d.edit.audio.push({
      trackId: musicTracks[musicTracks.length - 1].id,
      offsetSec: 0,
      volume: DEFAULT_VOLUME.music,
    });
  }
}
