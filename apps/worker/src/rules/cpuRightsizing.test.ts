import { describe, it, expect } from "vitest";
import { cpuRightsizing } from "./cpuRightsizing.js";
import type { AnalysisInput } from "../analysisInputs.js";

// A baseline over-provisioned, unmanaged workload with enough history.
function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    workloadId: "w1",
    namespace: "shop",
    name: "checkout",
    kind: "deployment",
    managedBy: "none",
    replicas: 3,
    cpuRequestM: 500,
    memRequestBytes: null,
    cpuLimitM: null,
    memLimitBytes: null,
    cpuP95M: 120,
    memMaxBytes: null,
    restarts: 0,
    daysOfHistory: 14,
    cpuSufficiency: "sufficient",
    memSufficiency: "sufficient",
    ...over,
  };
}

describe("cpuRightsizing", () => {
  it("proposes p95 + 15% headroom for an over-provisioned workload", () => {
    const rec = cpuRightsizing(input());
    expect(rec).not.toBeNull();
    expect(rec!.proposedCpuM).toBe(138); // ceil(120 * 1.15)
    expect(rec!.currentCpuM).toBe(500);
    expect(rec!.savingsM).toBe(362);
    expect(rec!.confidence).toBe("high");
  });

  it("marks preliminary history as low confidence", () => {
    expect(cpuRightsizing(input({ cpuSufficiency: "preliminary" }))!.confidence).toBe("low");
  });

  it("skips HPA- and VPA-managed workloads (autoscaler owns them)", () => {
    expect(cpuRightsizing(input({ managedBy: "hpa" }))).toBeNull();
    expect(cpuRightsizing(input({ managedBy: "vpa" }))).toBeNull();
  });

  it("stays quiet when there's no usage data or no current request", () => {
    expect(cpuRightsizing(input({ cpuP95M: null }))).toBeNull();
    expect(cpuRightsizing(input({ cpuRequestM: null }))).toBeNull();
  });

  it("skips tiny reductions (< 10%)", () => {
    // request 150, p95 130 → proposed ceil(149.5)=150 → not <10% smaller → null
    expect(cpuRightsizing(input({ cpuRequestM: 150, cpuP95M: 130 }))).toBeNull();
  });

  it("skips under-provisioned workloads (usage above request)", () => {
    // p95 600 > request 500 → proposed 690 > request → null (raising is a different rule)
    expect(cpuRightsizing(input({ cpuRequestM: 500, cpuP95M: 600 }))).toBeNull();
  });
});
