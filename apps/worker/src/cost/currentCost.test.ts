import { describe, it, expect } from "vitest";
import {
  computeClusterCost,
  HOURS_PER_MONTH,
  type CostWorkload,
  type PricedNode,
} from "./currentCost.js";

// Two m5.large nodes @ $0.096/hr → $0.192/hr → 730h.
const NODES: PricedNode[] = [
  { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: 0.096 },
  { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: 0.096 },
];

const wl = (over: Partial<CostWorkload> = {}): CostWorkload => ({
  workloadId: "w1",
  namespace: "shop",
  name: "checkout",
  replicas: 1,
  cpuRequestM: 500,
  memRequestBytes: 1_000_000_000,
  ...over,
});

describe("computeClusterCost", () => {
  it("cluster cost = Σ node $/hr × 730", () => {
    const c = computeClusterCost(NODES, [wl()]);
    expect(c.clusterMonthlyUsd).toBe(0.192 * HOURS_PER_MONTH); // 140.16
    expect(c.pricedNodeCount).toBe(2);
  });

  it("attributes the full cluster cost to a single workload", () => {
    const c = computeClusterCost(NODES, [wl()]);
    expect(c.workloads[0]!.monthlyUsd).toBeCloseTo(c.clusterMonthlyUsd, 4);
  });

  it("splits cost by requests share between two identical workloads", () => {
    const c = computeClusterCost(NODES, [
      wl({ workloadId: "a", name: "a" }),
      wl({ workloadId: "b", name: "b" }),
    ]);
    expect(c.workloads[0]!.monthlyUsd).toBeCloseTo(c.clusterMonthlyUsd / 2, 3);
    expect(c.workloads[1]!.monthlyUsd).toBeCloseTo(c.clusterMonthlyUsd / 2, 3);
  });

  it("gives a bigger share to the workload requesting more", () => {
    const c = computeClusterCost(NODES, [
      wl({ workloadId: "big", name: "big", cpuRequestM: 900, memRequestBytes: 3_000_000_000 }),
      wl({ workloadId: "small", name: "small", cpuRequestM: 100, memRequestBytes: 1_000_000_000 }),
    ]);
    const big = c.workloads.find((w) => w.name === "big")!;
    const small = c.workloads.find((w) => w.name === "small")!;
    expect(big.monthlyUsd).toBeGreaterThan(small.monthlyUsd);
  });

  it("rolls workloads up into namespaces", () => {
    const c = computeClusterCost(NODES, [
      wl({ workloadId: "a", namespace: "shop", name: "a" }),
      wl({ workloadId: "b", namespace: "shop", name: "b" }),
      wl({ workloadId: "c", namespace: "infra", name: "c" }),
    ]);
    const shop = c.namespaces.find((n) => n.name === "shop")!;
    const infra = c.namespaces.find((n) => n.name === "infra")!;
    expect(shop.monthlyUsd).toBeCloseTo(c.clusterMonthlyUsd * (2 / 3), 2);
    expect(infra.monthlyUsd).toBeCloseTo(c.clusterMonthlyUsd * (1 / 3), 2);
  });

  it("counts unpriced nodes and excludes them from the total", () => {
    const c = computeClusterCost(
      [...NODES, { cpuAllocatableM: 2000, memAllocatableBytes: 8_000_000_000, pricePerHourUsd: null }],
      [wl()],
    );
    expect(c.unpricedNodeCount).toBe(1);
    expect(c.clusterMonthlyUsd).toBe(0.192 * HOURS_PER_MONTH); // unchanged
  });

  it("exposes per-unit blended rates for downstream waste pricing", () => {
    const c = computeClusterCost(NODES, [wl()]);
    // CPU half of $0.192/hr over 4000m allocatable.
    expect(c.perMCpuHrUsd).toBeCloseTo((0.192 * 0.5) / 4000, 9);
    expect(c.perByteHrUsd).toBeCloseTo((0.192 * 0.5) / 16_000_000_000, 15);
  });
});
