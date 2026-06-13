import type { GenerationKind } from "@/types/generation";

/**
 * Job simulation for the MVP. Generation is async (Magnific pattern:
 * POST -> task_id -> GET/{task-id} or webhook_url). The shape mirrors the real
 * thing; swapping in live MCP/API calls means changing only the transport.
 */

let seq = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const BASE_CREDITS: Record<GenerationKind, number> = {
  image: 8,
  video: 45,
  audio: 6,
  edit: 5,
  concat: 2,
  upscale: 12,
};

export async function simulateJob(args: {
  kind: GenerationKind;
  prompt: string;
  makeUrl: () => string;
}): Promise<{ taskId: string; resultUrl: string; credits: number }> {
  const ms = args.kind === "video" || args.kind === "concat" ? 1400 : 800;
  await new Promise((r) => setTimeout(r, ms + Math.random() * 600));
  // Small variance so preflight vs. final differ realistically.
  const credits = Math.round(
    BASE_CREDITS[args.kind] * (0.9 + Math.random() * 0.3),
  );
  return { taskId: id("task"), resultUrl: args.makeUrl(), credits };
}

/** Deterministic SVG data-URI placeholder so previews render without network. */
export function placeholderAsset(kind: GenerationKind, prompt: string): string {
  const hue = Math.abs(hash(prompt)) % 360;
  const label = kind.toUpperCase();
  const text = prompt.slice(0, 42).replace(/[<>&]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'>
  <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
    <stop offset='0' stop-color='hsl(${hue} 60% 22%)'/>
    <stop offset='1' stop-color='hsl(${(hue + 40) % 360} 55% 12%)'/>
  </linearGradient></defs>
  <rect width='640' height='360' fill='url(#g)'/>
  <text x='24' y='44' fill='hsl(${hue} 80% 78%)' font-family='monospace' font-size='20'>${label}</text>
  <text x='24' y='200' fill='#e8ecff' font-family='sans-serif' font-size='22'>${escapeXml(text)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
