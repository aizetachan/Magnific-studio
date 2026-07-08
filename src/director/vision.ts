import { getLang } from "@/i18n";

/**
 * Vision helper: derive the global STYLE GUIDELINES from moodboard images.
 * Uses the user's own key (Claude or OpenAI, per the Director provider) —
 * the images and the key never touch our servers.
 */

const INSTRUCTION_ES =
  "Analiza estas imágenes de referencia de estilo visual para un corto y escribe una definición de estilo global " +
  "que sirva como directrices de producción: técnica/medio, paleta de color, iluminación, texturas, óptica " +
  "(lente/profundidad de campo/grano), composición y tono emocional. Escríbela como un único párrafo denso y " +
  "accionable listo para inyectarse en prompts de generación de imagen. SOLO el párrafo, sin preámbulos.";
const INSTRUCTION_EN =
  "Analyze these visual-style reference images for a short film and write a global style definition to be used as " +
  "production guidelines: technique/medium, color palette, lighting, textures, optics (lens/depth of field/grain), " +
  "composition and emotional tone. Write it as ONE dense, actionable paragraph ready to inject into image-generation " +
  "prompts. Output ONLY the paragraph, no preamble.";

export interface VisionInput {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
  /** base64 payloads (no data: prefix) + mime, up to 4 images. */
  images: Array<{ base64: string; mime: string }>;
}

export async function deriveStyleGuidelines({ provider, apiKey, model, images }: VisionInput): Promise<string> {
  const instruction = getLang() === "en" ? INSTRUCTION_EN : INSTRUCTION_ES;
  const imgs = images.slice(0, 4);
  if (imgs.length === 0) throw new Error("No hay imágenes en el moodboard");
  if (!apiKey.trim()) throw new Error("Conecta tu API en Ajustes para usar esta función");

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              ...imgs.map((i) => ({
                type: "image_url" as const,
                image_url: { url: `data:${i.mime};base64,${i.base64}` },
              })),
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    const data = (await res.json()) as { choices: Array<{ message: { content?: string | null } }> };
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }

  const res = await fetch(`${(await import("@/config")).config.anthropicBase}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            ...imgs.map((i) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: i.mime, data: i.base64 },
            })),
            { type: "text", text: instruction },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
}
