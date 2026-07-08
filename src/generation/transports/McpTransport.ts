import type {
  GenerationRequest,
  GenerationResult,
  GenerationTransport,
  OnProgress,
  TransportCapability,
} from "@/types/generation";
import { config } from "@/config";
import { materializeAsset } from "@/state/assets";
import { placeholderAsset, simulateJob } from "./simulate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backend-relative asset paths (/api/director/...) → absolute fetchable URL. */
export function absDirectorUrl(url: string): string {
  return url.startsWith("/") ? new URL(url, window.location.origin).href : url;
}

/**
 * McpTransport — the default conversational generation layer.
 *
 * In the MVP it talks to the Magnific MCP server (OAuth, no API key, already
 * available) — tools like images_generate / video_generate / video_concatenate.
 * Claude orchestrates those tools, which is exactly what the Director backend
 * does (server/index.mjs): when live, this transport POSTs the request to
 * `${directorBase}/mcp-generate` (directorBase already includes /api/director),
 * server-side (OAuth/session off the browser). Otherwise it simulates.
 *
 * The MCP "never falls": if it can't cover a request, supports() returns false
 * and the Router simply routes that request elsewhere.
 */
export class McpTransport implements GenerationTransport {
  readonly id = "mcp" as const;
  readonly label = "McpTransport";
  private healthy = true;

  setHealthy(v: boolean) {
    this.healthy = v;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  supports(req: GenerationRequest, cap: TransportCapability): boolean {
    // The MCP is the real generation path: if it handles this KIND, it can take
    // any model — Magnific validates the model server-side (the static model list
    // would otherwise reject live/audio models like lyria or elevenlabs). The
    // model list still gates the API transport, which has narrower coverage.
    return cap.kinds.includes(req.kind);
  }

  async execute(
    req: GenerationRequest,
    onProgress?: OnProgress,
  ): Promise<GenerationResult> {
    // Live mode is always real: surface failures honestly, never fake an asset.
    if (config.magnificLive) {
      try {
        return await this.executeViaDirector(req, onProgress);
      } catch (err) {
        onProgress?.({ progress: 100, status: "failed" });
        return {
          ok: false,
          taskId: "mcp_error",
          creditsCharged: 0,
          mode: "mcp_default",
          transportLabel: this.label,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    // Offline default (VITE_MAGNIFIC_LIVE unset): simulated jobs so a fresh
    // clone is explorable without any connection.
    return this.simulate(req, onProgress);
  }

  /**
   * Real path: the Director backend starts a Magnific MCP generation and returns
   * a job id; we poll /mcp-status until it settles, surfacing live progress. The
   * status endpoint long-polls (~10s) so this stays responsive without hammering.
   */
  private async executeViaDirector(
    req: GenerationRequest,
    onProgress?: OnProgress,
  ): Promise<GenerationResult> {
    const start = await fetch(`${config.directorBase}/mcp-generate`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: req.kind,
        prompt: req.prompt,
        model: req.model,
        references: req.references,
        libraryRefs: req.libraryRefs,
        params: req.params,
      }),
    });
    if (!start.ok) throw new Error(`director ${start.status}`);
    const started = (await start.json()) as {
      ok: boolean;
      jobId?: string;
      status?: string;
      error?: string;
    };
    if (!started.ok || !started.jobId) {
      throw new Error(started.error ?? "director did not start a job");
    }

    onProgress?.({ progress: 5, status: "rendering", jobId: started.jobId });

    // Poll until terminal. Budget generously: video can take ~10 min + queue.
    const deadline = Date.now() + 20 * 60 * 1000;
    let last: {
      status?: string;
      progress?: number;
      resultUrl?: string;
      identifier?: string;
      credits?: number;
      model?: string;
      error?: string;
    } = {};
    while (Date.now() < deadline) {
      const res = await fetch(
        `${config.directorBase}/mcp-status?job=${encodeURIComponent(started.jobId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        await sleep(2000);
        continue;
      }
      last = await res.json();
      if (last.status === "ready") {
        // Local-first: pull the bytes ONCE from the one-shot proxy and store
        // them on the user's machine; the app uses the returned blob: URL.
        const assetName = req.assetHint
          ? `${req.assetHint}_${started.jobId.slice(-6)}`
          : started.jobId;
        const localUrl = last.resultUrl
          ? await materializeAsset(assetName, absDirectorUrl(last.resultUrl))
          : undefined;
        onProgress?.({ progress: 100, status: "ready" });
        return {
          ok: true,
          taskId: last.identifier ?? started.jobId,
          resultUrl: localUrl,
          creditsCharged: last.credits ?? 0,
          model: last.model,
          mode: "mcp_default",
          transportLabel: this.label,
        };
      }
      if (last.status === "failed") {
        onProgress?.({ progress: 100, status: "failed" });
        return {
          ok: false,
          taskId: last.identifier ?? started.jobId,
          creditsCharged: 0,
          mode: "mcp_default",
          transportLabel: this.label,
          error: last.error ?? "generation failed",
        };
      }
      onProgress?.({ progress: last.progress ?? 10, status: "rendering" });
      await sleep(1500);
    }
    throw new Error("generation timed out");
  }

  private async simulate(
    req: GenerationRequest,
    onProgress?: OnProgress,
  ): Promise<GenerationResult> {
    onProgress?.({ progress: 40, status: "rendering" });
    const { taskId, resultUrl, credits } = await simulateJob({
      kind: req.kind,
      prompt: req.prompt,
      makeUrl: () => placeholderAsset(req.kind, req.prompt),
    });
    onProgress?.({ progress: 100, status: "ready" });
    return {
      ok: true,
      taskId,
      resultUrl,
      creditsCharged: credits,
      mode: "mcp_default",
      transportLabel: this.label,
    };
  }
}
