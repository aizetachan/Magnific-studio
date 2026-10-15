import { describe, expect, it } from "vitest";
import {
  addLevelOnTop,
  addTake,
  childrenOf,
  codeOf,
  insertAfter,
  newProduction,
  nodeDuration,
  pathOf,
  removeNode,
  removeTopLevel,
  roleOf,
  segmentsFromCuts,
} from "./model";

describe("production tree", () => {
  it("builds code paths from the configurable levels", () => {
    const p = newProduction("Test");
    const shot = p.nodes.find((n) => n.level === 2)!;
    expect(pathOf(p, shot)).toBe("SQ010/SC010/SH0010");
    expect(roleOf(p, p.nodes[0])).toBe("group");
    expect(roleOf(p, p.nodes[1])).toBe("production");
    expect(roleOf(p, shot)).toBe("unit");
  });

  it("inserts between siblings using the numbering gap, renumbering when full", () => {
    const p = newProduction("Test");
    const sc = p.nodes.find((n) => n.level === 1)!;
    const [a] = childrenOf(p, sc.id);
    const mid = insertAfter(p, a.id);
    expect(codeOf(p, mid)).toBe("SH0015");
    for (let i = 0; i < 4; i++) insertAfter(p, a.id);
    const nums = childrenOf(p, sc.id).map((n) => n.number);
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums).toEqual([...nums].sort((x, y) => x - y));
  });

  it("adds and removes a top level without losing nodes", () => {
    const p = newProduction("Test");
    const count = p.nodes.length;
    addLevelOnTop(p, { name: "Episodio", prefix: "EP", step: 1, pad: 2, canGenerate: false, maxVideoSec: 30 });
    const shot = p.nodes.find((n) => n.level === 3)!;
    expect(pathOf(p, shot)).toBe("EP01/SQ010/SC010/SH0010");
    expect(removeTopLevel(p)).toBe(true);
    expect(p.nodes.length).toBe(count);
    expect(pathOf(p, shot)).toBe("SQ010/SC010/SH0010");
  });

  it("removing a node drops its subtree, media and takes", () => {
    const p = newProduction("Test");
    const sc = p.nodes.find((n) => n.level === 1)!;
    p.media.push({ id: "m1", nodeId: sc.id, kind: "video", version: 1, prompt: "", model: "auto", durationSec: 30, status: "ready", progress: 100, createdBy: "a", createdAt: 0 });
    const shot = childrenOf(p, sc.id)[0];
    addTake(p, { nodeId: shot.id, mediaId: "m1", inSec: 0, outSec: 4, by: "a" });
    removeNode(p, sc.id);
    expect(p.nodes.length).toBe(1);
    expect(p.media.length).toBe(0);
    expect(p.takes.length).toBe(0);
  });
});

describe("cutting", () => {
  it("turns cut points into contiguous segments", () => {
    expect(segmentsFromCuts(30, [12.04, 4.2, 4.2, 0, 31])).toEqual([
      { inSec: 0, outSec: 4.2 },
      { inSec: 4.2, outSec: 12 },
      { inSec: 12, outSec: 30 },
    ]);
  });

  it("a scene clip distributed to shots sums into the scene duration", () => {
    const p = newProduction("Test");
    const sc = p.nodes.find((n) => n.level === 1)!;
    const [a, b] = childrenOf(p, sc.id);
    addTake(p, { nodeId: a.id, mediaId: "m", inSec: 0, outSec: 4.2, by: "x" });
    addTake(p, { nodeId: b.id, mediaId: "m", inSec: 4.2, outSec: 12, by: "x" });
    expect(nodeDuration(p, sc)).toBe(12);
    expect(a.status).toBe("wip");
  });
});
