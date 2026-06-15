import { describe, expect, it } from "vitest";
import { GenerationBlock } from "./GenerationBlock";
import type { GenerationRequest } from "@/types/generation";

const imageReq: GenerationRequest = {
  kind: "image",
  prompt: "plano detalle de la esfera",
  model: "recraft-v4-1",
};

describe("GenerationBlock Router — 4 execution modes (§5.5)", () => {
  it("mode 1: MCP-default for conversational operation", () => {
    const block = new GenerationBlock({ apiConnected: false });
    expect(block.preflight(imageReq).mode).toBe("mcp_default");
  });

  it("mode 2: API-fallback when MCP can't serve but API can", () => {
    const block = new GenerationBlock({ apiConnected: true });
    // MCP supports image+model normally; mark it unhealthy so only API remains.
    block.mcp.setHealthy(false);
    expect(block.preflight(imageReq).mode).toBe("api_fallback");
  });

  it("mode 3: MCP->API handoff is Claude-decided via preparedForApi", () => {
    const block = new GenerationBlock({ apiConnected: true });
    const pre = block.preflight({ ...imageReq, preparedForApi: true });
    expect(pre.mode).toBe("mcp_to_api");
    expect(pre.transportLabel).toContain("ApiTransport");
  });

  it("mode 4: parallel splits work across API + MCP", () => {
    const block = new GenerationBlock({ apiConnected: true });
    const pre = block.preflight({ ...imageReq, params: { parallel: true } });
    expect(pre.mode).toBe("parallel");
    expect(pre.transports).toEqual(["api", "mcp"]);
  });

  it("config-driven CapabilityMap: API alone cannot serve audio", async () => {
    const block = new GenerationBlock({ apiConnected: true });
    block.mcp.setHealthy(false); // only API left, which lacks 'audio'
    const res = await block.generate({
      kind: "audio",
      prompt: "score tenso",
      model: "auto",
    });
    expect(res.ok).toBe(false);
  });

  it("parallel assembles both parts and sums credits", async () => {
    const block = new GenerationBlock({ apiConnected: true });
    const res = await block.generate({ ...imageReq, params: { parallel: true } });
    expect(res.mode).toBe("parallel");
    expect(res.parts).toHaveLength(2);
    expect(res.creditsCharged).toBeGreaterThan(0);
  });
});
