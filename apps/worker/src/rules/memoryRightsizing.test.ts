import { describe, it, expect } from "vitest";
import { memoryRightsizing } from "./memoryRightsizing.js";
import type { AnalysisInput } from "../analysisInputs.js";

const MiB = 1048576;

// Baseline over-provisioned, unmanaged, stable workload with enough history.
function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    workloadId: "w1",
    namespace: "shop",
    name: "checkout",
    kind: "deployment",
    managedBy: "none",
    gitopsOwned: false,
    pdbMinReplicas: null,
    replicas: 3,
    cpuRequestM: null,
    memRequestBytes: 500 * MiB,
    cpuLimitM: null,
    memLimitBytes: 500 * MiB,
    cpuP95M: null,
    memMaxBytes: 200 * MiB,
    restarts: 0,
    daysOfHistory: 20,
    cpuSufficiency: "sufficient",
    memSufficiency: "sufficient",
    ...over,
  };
}

describe("memoryRightsizing", () => {
  it("proposes peak (MAX) + 15% for an over-provisioned workload", () => {
    const rec = memoryRightsizing(input());
    expect(rec).not.toBeNull();
    expect(rec!.proposedMemBytes).toBe(Math.ceil(200 * MiB * 1.15)); // MAX + 15%
    expect(rec!.currentMemBytes).toBe(500 * MiB);
    expect(rec!.confidence).toBe("high");
  });

  it("OOM SAFETY: leaves a restarting workload alone (never lowers memory)", () => {
    expect(memoryRightsizing(input({ restarts: 1 }))).toBeNull();
  });

  it("skips HPA- and VPA-managed workloads", () => {
    expect(memoryRightsizing(input({ managedBy: "hpa" }))).toBeNull();
    expect(memoryRightsizing(input({ managedBy: "vpa" }))).toBeNull();
  });

  it("stays quiet with no usage data or no current request", () => {
    expect(memoryRightsizing(input({ memMaxBytes: null }))).toBeNull();
    expect(memoryRightsizing(input({ memRequestBytes: null }))).toBeNull();
  });

  it("skips tiny reductions (< 10%)", () => {
    // request 220Mi, peak 200Mi → proposed 230Mi > request → null
    expect(memoryRightsizing(input({ memRequestBytes: 220 * MiB, memMaxBytes: 200 * MiB }))).toBeNull();
  });

  it("marks preliminary history as low confidence", () => {
    expect(memoryRightsizing(input({ memSufficiency: "preliminary" }))!.confidence).toBe("low");
  });
});
