/**
 * Generation for Production: reuses Studio's GenerationBlock (Router + MCP/API
 * transports, simulated when nothing is connected). A new Media version is
 * created at the node, tracked through the async job, then mirrored to the
 * desktop folder as soon as it is ready.
 */

import { GenerationBlock } from "@/generation/GenerationBlock";
import { labelOf, newId, nextVersion, type MediaKind, type Production } from "./model";
import { mirrorMedia, mirrorMetadata } from "./mirror";
import type { ProductionStore } from "./store";

const generation = new GenerationBlock();

export interface GenerateArgs {
  nodeId: string;
  kind: MediaKind;
  prompt: string;
  model: string;
  durationSec: number;
  /** Image media used as the video's start frame. */
  sourceMediaId?: string;
}

export async function generateMedia(store: ProductionStore, a: GenerateArgs): Promise<void> {
  const p0 = store.get();
  const node = p0.nodes.find((n) => n.id === a.nodeId);
  if (!node) return;
  const source = a.sourceMediaId ? p0.media.find((m) => m.id === a.sourceMediaId) : undefined;
  const id = newId("m");
  const scope = labelOf(p0, node);

  store.update((d) => {
    d.media.push({
      id,
      nodeId: a.nodeId,
      kind: a.kind,
      version: nextVersion(d, a.nodeId, a.kind),
      prompt: a.prompt,
      model: a.model,
      durationSec: a.kind === "video" ? a.durationSec : 0,
      status: "queued",
      progress: 5,
      sourceMediaId: source?.id,
      createdBy: store.user || "Anónimo",
      createdAt: Date.now(),
    });
    const n = d.nodes.find((x) => x.id === a.nodeId)!;
    if (n.status === "todo") n.status = "wip";
  });

  const patch = (fn: (m: Production["media"][number]) => void) =>
    store.update((d) => {
      const m = d.media.find((x) => x.id === id);
      if (m) fn(m);
    });

  try {
    const res = await generation.generate(
      {
        kind: a.kind,
        prompt: a.prompt,
        model: a.model,
        references: source?.taskId ? [source.taskId] : undefined,
        params: a.kind === "video" ? { duration: a.durationSec } : undefined,
        scopeLabel: scope,
        assetHint: scope.replace(/\s·\s/g, "_"),
      },
      ({ progress }) =>
        patch((m) => {
          m.status = "rendering";
          m.progress = Math.max(m.progress, Math.min(99, progress ?? m.progress));
        }),
    );
    if (!res.ok || !res.resultUrl) throw new Error(res.error ?? "La generación no devolvió resultado");
    patch((m) => {
      m.status = "ready";
      m.progress = 100;
      m.url = res.resultUrl;
      m.taskId = res.taskId;
      m.credits = res.creditsCharged;
      if (res.model) m.model = res.model;
    });
    const p = store.get();
    const m = p.media.find((x) => x.id === id);
    if (m) {
      const filePath = await mirrorMedia(p, m);
      if (filePath) patch((x) => (x.filePath = filePath));
      await mirrorMetadata(store.get());
    }
  } catch (e) {
    patch((m) => {
      m.status = "failed";
      m.error = e instanceof Error ? e.message : String(e);
    });
  }
}

/** Run generations a few at a time (mass production without flooding the API). */
export async function generateBatch(store: ProductionStore, jobs: GenerateArgs[], concurrency = 2): Promise<void> {
  const queue = [...jobs];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) await generateMedia(store, j);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
