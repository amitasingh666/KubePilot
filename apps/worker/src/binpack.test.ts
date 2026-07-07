import { describe, it, expect } from "vitest";
import { simulateCluster, type SimNode, type SimPod } from "./binpack.js";

const node = (cpuM: number, memGi: number): SimNode => ({ cpuM, memBytes: memGi * 1024 ** 3 });
const pod = (cpuM: number, memGi: number): SimPod => ({ cpuM, memBytes: memGi * 1024 ** 3 });

describe("simulateCluster", () => {
  it("packs pods onto fewer nodes and reports reclaimable", () => {
    // 3 nodes of 1000m/4Gi; pods total 1500m/6Gi → fit on 2 nodes → 1 reclaimable.
    const nodes = [node(1000, 4), node(1000, 4), node(1000, 4)];
    const pods = [pod(500, 2), pod(500, 2), pod(500, 2)];
    const r = simulateCluster(nodes, pods);
    expect(r.totalNodes).toBe(3);
    expect(r.nodesNeeded).toBe(2);
    expect(r.reclaimable).toBe(1);
  });

  it("reports 0 reclaimable when pods already fill the nodes", () => {
    const nodes = [node(1000, 4), node(1000, 4)];
    const pods = [pod(900, 3), pod(900, 3)]; // one per node, can't consolidate
    expect(simulateCluster(nodes, pods).reclaimable).toBe(0);
  });

  it("is memory-aware, not just CPU", () => {
    // Tiny CPU but each pod needs a whole node's memory → no consolidation.
    const nodes = [node(1000, 4), node(1000, 4)];
    const pods = [pod(10, 4), pod(10, 4)];
    expect(simulateCluster(nodes, pods).reclaimable).toBe(0);
  });

  it("never overstates: a pod too big for any node → 0 reclaimable", () => {
    const nodes = [node(1000, 4), node(1000, 4)];
    const pods = [pod(5000, 2)]; // doesn't fit any node
    expect(simulateCluster(nodes, pods).reclaimable).toBe(0);
  });

  it("all nodes reclaimable-but-one when there are no pods → needs 0", () => {
    const r = simulateCluster([node(1000, 4), node(1000, 4)], []);
    expect(r.nodesNeeded).toBe(0);
    expect(r.reclaimable).toBe(2);
  });
});
