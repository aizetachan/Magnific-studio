// Magnific Studio — local timeline render with native ffmpeg.
//
// The Magnific MCP can only concatenate clips (it uses each clip's own audio and
// can't trim or mux an external track). The in-app editor needs real trimming +
// voice/music mux, so we render the final video LOCALLY with ffmpeg: the backend
// already localizes every asset to disk, so it has the source files at hand.
//
// Two stages for robustness:
//   1) Normalize+trim each clip to a uniform intermediate (same codec/size/fps,
//      always with an audio track) and concat them with the concat demuxer.
//   2) Mix the voice/music tracks over the concatenated clip audio (offset +
//      volume), keeping the video as-is.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;

let ffmpegOk; // cache

/** Whether native ffmpeg + ffprobe are available on this machine. */
export async function hasFfmpeg() {
  if (ffmpegOk !== undefined) return ffmpegOk;
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
    ffmpegOk = true;
  } catch {
    ffmpegOk = false;
  }
  return ffmpegOk;
}

/** Spawn a command, resolving with stdout or rejecting with a stderr tail. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`));
    });
  });
}

/** True if the media file has at least one audio stream. */
async function hasAudioStream(path) {
  try {
    const out = await run("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=index", "-of", "csv=p=0", path,
    ]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Render a timeline to outPath.
 * spec.clips: [{ path, inSec?, outSec? }]  (already in playback order)
 * spec.audio: [{ path, offsetSec?, volume?, inSec?, outSec? }]
 */
export async function renderTimeline(spec, { workDir, outPath }) {
  const clips = (spec.clips ?? []).filter((c) => c?.path);
  if (clips.length === 0) throw new Error("No hay clips para renderizar");
  await mkdir(workDir, { recursive: true });

  // --- Stage 1: normalize + trim each clip to a uniform intermediate. ---
  const vf =
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
  const inters = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const inSec = num(c.inSec, 0);
    const dur = c.outSec != null ? Math.max(0.1, num(c.outSec, 0) - inSec) : undefined;
    const inter = join(workDir, `inter_${i}.mp4`);
    // A muted clip (or one with no audio) gets a silent track so the concatenated
    // base has a uniform stream layout.
    const hasA = c.mute ? false : await hasAudioStream(c.path);
    const pre = [];
    if (inSec > 0) pre.push("-ss", String(inSec));
    pre.push("-i", c.path);
    if (dur != null) pre.push("-t", String(dur));

    const args = ["-y", ...pre];
    if (!hasA) {
      // Add a silent track so every intermediate has the same stream layout.
      args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      if (dur != null) args.push("-t", String(dur));
    }
    args.push(
      "-vf", vf,
      "-map", "0:v:0",
      "-map", hasA ? "0:a:0" : "1:a:0",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      "-shortest",
      inter,
    );
    await run("ffmpeg", args);
    inters.push(inter);
  }

  // Concat the uniform intermediates (stream copy — same params).
  const listPath = join(workDir, "list.txt");
  await writeFile(listPath, inters.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const base = join(workDir, "base.mp4");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", base]);

  // --- Stage 2: mux voice/music over the concatenated clip audio. ---
  const tracks = (spec.audio ?? []).filter((a) => a?.path);
  const muteVideo = !!spec.muteVideo;

  // No external tracks: keep the clip audio, or strip it if the video is muted.
  if (tracks.length === 0) {
    if (muteVideo) await run("ffmpeg", ["-y", "-i", base, "-c:v", "copy", "-an", outPath]);
    else await run("ffmpeg", ["-y", "-i", base, "-c", "copy", outPath]);
    return;
  }

  const args = ["-y", "-i", base];
  for (const t of tracks) args.push("-i", t.path);

  const parts = [];
  const labels = muteVideo ? [] : ["[0:a]"]; // base (clip) audio unless muted
  tracks.forEach((t, idx) => {
    const i = idx + 1;
    const offMs = Math.max(0, Math.round(num(t.offsetSec, 0) * 1000));
    const vol = num(t.volume, 1);
    const inSec = num(t.inSec, 0);
    const trim =
      t.outSec != null ? `atrim=${inSec}:${num(t.outSec, 0)},` : inSec > 0 ? `atrim=${inSec},` : "";
    parts.push(
      `[${i}:a]${trim}asetpts=PTS-STARTPTS,adelay=${offMs}|${offMs},volume=${vol}[a${i}]`,
    );
    labels.push(`[a${i}]`);
  });
  const n = labels.length;
  parts.push(`${labels.join("")}amix=inputs=${n}:duration=first:normalize=0[aout]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2",
    outPath,
  );
  await run("ffmpeg", args);
}

/** Best-effort cleanup of a work directory. */
export async function cleanupDir(dir) {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
