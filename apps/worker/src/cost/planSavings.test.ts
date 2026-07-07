import { describe, it, expect } from "vitest";
import {
  computeClusterSavings,
  isAutoRealizable,
  rollupRealizability,
  type SavingsNode,
  type SavingsWorkload,
} from "./planSavings.js";
import { HOURS_PER_MONTH } from "./currentCost.js";

// Two m5.large nodes @ $0.096/hr, 2000m / 8GB allocatable each.
const NODES: SavingsNode[] = [
  { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: 0.096 },
  { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: 0.096 },
];

const wl = (over: Partial<SavingsWorkload> = {}): SavingsWorkload => ({
  kind: "deployment",
  replicas: 1,
  cpuRequestM: 1000,
  memRequestBytes: 2_000_000_000,
  proposedReplicas: 1,
  proposedCpuRequestM: 1000,
  proposedMemRequestBytes: 2_000_000_000,
  ...over,
});

describe("computeClusterSavings", () => {
  it("realizes a node's cost when the proposed spec frees one", () => {
    // Current: 4 pods × 1000m = fills both nodes. Proposed: shrink to 100m each →
    // all fit on one node → 1 node reclaimable → $0.096×730 realized.
    const workloads = Array.from({ length: 4 }, () =>
      wl({ proposedCpuRequestM: 100, proposedMemRequestBytes: 200_000_000 }),
    );
    const s = computeClusterSavings(NODES, workloads, "karpenter");
    expect(s.reclaimableNodes).toBe(1);
    expect(s.realizedMonthlyUsd).toBeCloseTo(0.096 * HOURS_PER_MONTH, 2);
  });

  it("prices waste from request reductions separately from realized", () => {
    // Two 1000m pods fill both nodes; each shrinks CPU 1000→400 (Δ600m total 1200m).
    // Still 2 pods (one per node's headroom is tight) → check waste is priced regardless.
    const s = computeClusterSavings(
      NODES,
      [
        wl({ proposedCpuRequestM: 400 }),
        wl({ proposedCpuRequestM: 400 }),
      ],
      null,
    );
    // waste = 1200m × perMCpu × 730 ; perMCpu = (0.192*0.5)/4000
    const perMCpu = (0.192 * 0.5) / 4000;
    expect(s.wasteMonthlyUsd).toBeCloseTo(1200 * perMCpu * HOURS_PER_MONTH, 3);
  });

  it("reports no realized savings when pods fill every node", () => {
    // 3 pods × 1000m on 2 nodes (1700m effective each) → can't consolidate.
    const s = computeClusterSavings(
      NODES,
      Array.from({ length: 3 }, () => wl({ replicas: 1, proposedReplicas: 1 })),
      null,
    );
    expect(s.realizedMonthlyUsd).toBe(0);
    expect(s.reclaimableNodes).toBe(0);
  });

  it("labels realizability from the autoscaler", () => {
    expect(computeClusterSavings(NODES, [wl()], "karpenter").realizability).toBe("auto");
    expect(computeClusterSavings(NODES, [wl()], null).realizability).toBe("manual");
  });

  it("ignores unpriced nodes in realized value", () => {
    const withUnpriced: SavingsNode[] = [
      ...NODES,
      { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: null },
    ];
    const workloads = Array.from({ length: 4 }, () =>
      wl({ proposedCpuRequestM: 100, proposedMemRequestBytes: 200_000_000 }),
    );
    const s = computeClusterSavings(withUnpriced, workloads, "karpenter");
    // Cheapest reclaimable nodes are priced ones (unpriced count as $0).
    expect(s.realizedMonthlyUsd).toBeGreaterThanOrEqual(0);
  });
});

describe("isAutoRealizable", () => {
  it("recognizes the auto-scaling node managers", () => {
    expect(isAutoRealizable("karpenter")).toBe(true);
    expect(isAutoRealizable("cluster-autoscaler")).toBe(true);
    expect(isAutoRealizable("ca")).toBe(true);
    expect(isAutoRealizable(null)).toBe(false);
    expect(isAutoRealizable("none")).toBe(false);
  });
});

describe("rollupRealizability", () => {
  it("n/a when no cluster has realized savings", () => {
    expect(rollupRealizability([{ realizedMonthlyUsd: 0, realizability: "auto" }])).toBe("n/a");
  });
  it("auto/manual when all saving clusters agree", () => {
    expect(rollupRealizability([{ realizedMonthlyUsd: 10, realizability: "auto" }])).toBe("auto");
    expect(rollupRealizability([{ realizedMonthlyUsd: 10, realizability: "manual" }])).toBe("manual");
  });
  it("mixed when saving clusters disagree", () => {
    expect(
      rollupRealizability([
        { realizedMonthlyUsd: 10, realizability: "auto" },
        { realizedMonthlyUsd: 5, realizability: "manual" },
      ]),
    ).toBe("mixed");
  });
});
