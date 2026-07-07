import { describe, it, expect } from "vitest";
import { unusedCleanup } from "./unusedCleanup.js";
import type { AnalysisInput } from "../analysisInputs.js";

function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    workloadId: "w1",
    namespace: "shop",
    name: "legacy-worker",
    kind: "deployment",
    managedBy: "none",
    gitopsOwned: false,
    pdbMinReplicas: null,
    replicas: 2,
    cpuRequestM: 100,
    memRequestBytes: null,
    cpuLimitM: null,
    memLimitBytes: null,
    cpuP95M: 0, // idle
    memMaxBytes: null,
    restarts: 0,
    daysOfHistory: 20,
    cpuSufficiency: "sufficient",
    memSufficiency: "sufficient",
    ...over,
  };
}

describe("unusedCleanup", () => {
  it("flags a Deployment scaled to 0 replicas (no history needed)", () => {
    const rec = unusedCleanup(input({ replicas: 0, cpuSufficiency: "preliminary" }));
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("scaled-to-zero");
    expect(rec!.confidence).toBe("low");
  });

  it("flags a running-but-idle Deployment when history is sufficient", () => {
    const rec = unusedCleanup(input({ cpuP95M: 0 }));
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe("idle");
  });

  it("does NOT flag idle when history is only preliminary", () => {
    expect(unusedCleanup(input({ cpuP95M: 0, cpuSufficiency: "preliminary" }))).toBeNull();
  });

  it("does NOT flag a workload that's actually doing work", () => {
    expect(unusedCleanup(input({ cpuP95M: 50 }))).toBeNull();
  });

  it("skips autoscaler-managed and non-Deployment workloads", () => {
    expect(unusedCleanup(input({ managedBy: "hpa" }))).toBeNull();
    expect(unusedCleanup(input({ kind: "daemonset" }))).toBeNull();
  });
});
