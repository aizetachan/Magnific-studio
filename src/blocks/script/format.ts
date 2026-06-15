import type { Project } from "@/types/project";

/** Render the project as a clean, readable screenplay-style plain-text document. */
export function formatScript(project: Project): string {
  const { story, scenes } = project;
  const out: string[] = [];

  out.push(project.name.toUpperCase());
  if (story.logline) out.push("", story.logline);
  if (story.tone) out.push("", `Tono: ${story.tone}`);

  if (story.characters.length) {
    out.push("", "PERSONAJES");
    for (const c of story.characters) {
      out.push(`  · ${c.name} — ${c.description}`);
    }
  }

  out.push("", "=".repeat(64), "");

  const ordered = [...scenes].sort((a, b) => a.number - b.number);
  for (const s of ordered) {
    out.push(`ESCENA ${s.number}`);
    out.push(s.heading.toUpperCase());
    out.push("");
    if (s.action.trim()) out.push(s.action.trim(), "");
    if (s.dialogue.trim()) out.push(s.dialogue.trim(), "");
    out.push(`(duración aprox. ${s.durationSec}s)`);
    out.push("", "-".repeat(64), "");
  }

  return out.join("\n");
}
