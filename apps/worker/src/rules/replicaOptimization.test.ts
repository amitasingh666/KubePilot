import { describe, it, expect } from "vitest";
import { replicaOptimization } from "./replicaOptimization.js";
import type { AnalysisInput } from "../analysisInputs.js";

// Baseline: a bare Deployment with 5 replicas, each barely using its CPU request.
function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    workloadId: "w1",
    namespace: "shop",
    name: "checkout",
    kind: "deployment",
    managedBy: "none",
    gitopsOwned: false,
    pdbMinReplicas: null,
    replicas: 5,
    cpuRequestM: 200,
    memRequestBytes: null,
    cpuLimitM: null,
    memLimitBytes: null,
    cpuP95M: 10, // 10/200 = 5% per-replica util → over-provisioned
    memMaxBytes: null,
    restarts: 0,
    daysOfHistory: 20,
    cpuSufficiency: "sufficient",
    memSufficiency: "sufficient",
    ...over,
  };
}

describe("replicaOptimization", () => {
  it("flags an over-replicated, low-utilization Deployment toward the HA floor", () => {
    const rec = replicaOptimization(input());
    expect(rec).not.toBeNull();
    expect(rec!.currentReplicas).toBe(5);
    expect(rec!.proposedReplicas).toBe(2);
    expect(rec!.confidence).toBe("low"); // always advisory
  });

  it("never proposes below a matching PDB's minAvailable", () => {
    const rec = replicaOptimization(input({ replicas: 5, pdbMinReplicas: 4 }));
    expect(rec).not.toBeNull();
    expect(rec!.proposedReplicas).toBe(4); // floor = max(2, pdbMin 4)
  });

  it("skips when the PDB floor leaves nothing to reduce", () => {
    expect(replicaOptimization(input({ replicas: 4, pdbMinReplicas: 4 }))).toBeNull();
  });

  it("skips autoscaler-managed workloads (they own replicas)", () => {
    expect(replicaOptimization(input({ managedBy: "hpa" }))).toBeNull();
    expect(replicaOptimization(input({ managedBy: "keda" }))).toBeNull();
  });

  it("skips non-Deployments", () => {
    expect(replicaOptimization(input({ kind: "statefulset" }))).toBeNull();
  });

  it("skips workloads with too few replicas (< 3)", () => {
    expect(replicaOptimization(input({ replicas: 2 }))).toBeNull();
  });

  it("skips when per-replica utilization is not low", () => {
    // 120/200 = 60% → adequately used → no rec
    expect(replicaOptimization(input({ cpuP95M: 120 }))).toBeNull();
  });

  it("stays quiet without a utilization signal", () => {
    expect(replicaOptimization(input({ cpuRequestM: null }))).toBeNull();
    expect(replicaOptimization(input({ cpuP95M: null }))).toBeNull();
  });
});
