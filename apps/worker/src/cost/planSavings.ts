// Stage E + F — node-level savings from the reconciled plan (pure).
//
// The honest split the PRD demands:
//   REALIZED = $ of nodes the repack can actually remove (rightsize → re-pack →
//              drain). This is money you stop paying.
//   WASTE    = $ value of the request reductions themselves. Shrinking requests
//              frees capacity but saves nothing until a node is removed — so we
//              report it separately, never added to realized.
//
// Realized prices the CHEAPEST reclaimable nodes (conservative lower bound):
// the bin-packer only tells us HOW MANY nodes are freed, not which, so we assume
// the least valuable ones go. Realizability (F) says whether an autoscaler will
// remove them automatically (Karpenter/CA) or a human must resize the node pool.

import { simulateCluster, type SimNode, type SimPod } from "../binpack.js";
import { HOURS_PER_MONTH } from "./currentCost.js";

const CPU_WEIGHT = Number(process.env.COST_CPU_WEIGHT ?? 0.5);
const BINPACK_BUFFER = Number(process.env.BINPACK_BUFFER ?? 0.85);

export type SavingsNode = {
  cpuAllocatableM: number;
  memAllocatableBytes: number;
  pricePerHourUsd: number | null;
};

// A workload with BOTH its current spec and the plan's proposed spec.
export type SavingsWorkload = {
  kind: string; // daemonsets reserve per-node overhead instead of packing as pods
  replicas: number;
  cpuRequestM: number;
  memRequestBytes: number;
  proposedReplicas: number;
  proposedCpuRequestM: number;
  proposedMemRequestBytes: number;
};

export type Realizability = "auto" | "manual";

export type ClusterSavings = {
  realizedMonthlyUsd: number;
  wasteMonthlyUsd: number;
  reclaimableNodes: number;
  totalNodes: number;
  perMCpuHrUsd: number;
  perByteHrUsd: number;
  realizability: Realizability;
};

// Autoscalers that remove emptied nodes on their own → savings are auto-realizable.
export function isAutoRealizable(autoscaler: string | null): boolean {
  const a = (autoscaler ?? "").toLowerCase();
  return a.includes("karpenter") || a.includes("cluster-autoscaler") || a === "ca";
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Repack a cluster at its PROPOSED spec and price what that frees. */
export function computeClusterSavings(
  nodes: SavingsNode[],
  workloads: SavingsWorkload[],
  autoscaler: string | null,
): ClusterSavings {
  const priced = nodes.filter((n) => n.pricePerHourUsd != null);
  const hourly = priced.reduce((s, n) => s + (n.pricePerHourUsd ?? 0), 0);

  // Blended per-unit rates (same model as currentCost) for waste pricing.
  const totalCpuAlloc = priced.reduce((s, n) => s + n.cpuAllocatableM, 0);
  const totalMemAlloc = priced.reduce((s, n) => s + n.memAllocatableBytes, 0);
  const perMCpuHrUsd = totalCpuAlloc > 0 ? (hourly * CPU_WEIGHT) / totalCpuAlloc : 0;
  const perByteHrUsd = totalMemAlloc > 0 ? (hourly * (1 - CPU_WEIGHT)) / totalMemAlloc : 0;

  // WASTE — value of the reduction in total requested resources (current → proposed).
  const curCpu = workloads.reduce((s, w) => s + w.replicas * w.cpuRequestM, 0);
  const curMem = workloads.reduce((s, w) => s + w.replicas * w.memRequestBytes, 0);
  const propCpu = workloads.reduce((s, w) => s + w.proposedReplicas * w.proposedCpuRequestM, 0);
  const propMem = workloads.reduce((s, w) => s + w.proposedReplicas * w.proposedMemRequestBytes, 0);
  const dCpu = Math.max(0, curCpu - propCpu);
  const dMem = Math.max(0, curMem - propMem);
  const wasteMonthlyUsd = round4((dCpu * perMCpuHrUsd + dMem * perByteHrUsd) * HOURS_PER_MONTH);

  // REALIZED — repack proposed pods, drain the cheapest freed nodes.
  const dsCpu = workloads
    .filter((w) => w.kind === "daemonset")
    .reduce((s, w) => s + w.proposedCpuRequestM, 0);
  const dsMem = workloads
    .filter((w) => w.kind === "daemonset")
    .reduce((s, w) => s + w.proposedMemRequestBytes, 0);

  const simNodes: SimNode[] = nodes.map((n) => ({
    cpuM: Math.max(0, n.cpuAllocatableM * BINPACK_BUFFER - dsCpu),
    memBytes: Math.max(0, n.memAllocatableBytes * BINPACK_BUFFER - dsMem),
  }));
  const pods: SimPod[] = [];
  for (const w of workloads) {
    if (w.kind === "daemonset") continue;
    for (let i = 0; i < w.proposedReplicas; i++) {
      pods.push({ cpuM: w.proposedCpuRequestM, memBytes: w.proposedMemRequestBytes });
    }
  }
  const sim = simulateCluster(simNodes, pods);

  // Price the cheapest `reclaimable` priced nodes as the ones removed.
  const monthly = priced
    .map((n) => (n.pricePerHourUsd ?? 0) * HOURS_PER_MONTH)
    .sort((a, b) => a - b);
  const realizedMonthlyUsd = round4(
    monthly.slice(0, Math.min(sim.reclaimable, monthly.length)).reduce((s, m) => s + m, 0),
  );

  return {
    realizedMonthlyUsd,
    wasteMonthlyUsd,
    reclaimableNodes: sim.reclaimable,
    totalNodes: sim.totalNodes,
    perMCpuHrUsd,
    perByteHrUsd,
    realizability: isAutoRealizable(autoscaler) ? "auto" : "manual",
  };
}

/** Combine per-cluster realizabilities into one plan-level label. */
export function rollupRealizability(
  perCluster: { realizedMonthlyUsd: number; realizability: Realizability }[],
): "auto" | "manual" | "mixed" | "n/a" {
  const withSavings = perCluster.filter((c) => c.realizedMonthlyUsd > 0);
  if (withSavings.length === 0) return "n/a";
  const auto = withSavings.some((c) => c.realizability === "auto");
  const manual = withSavings.some((c) => c.realizability === "manual");
  if (auto && manual) return "mixed";
  return auto ? "auto" : "manual";
}
