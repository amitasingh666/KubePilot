// Pure per-recommendation pricing (Phase 3, A1/A2 fix).
//
// Two DIFFERENT kinds of dollars, which must never be summed together:
//   REALIZED — money you actually stop paying (a node drained, a volume deleted).
//   WASTE    — the $ value of freed-up requests; not saved until a node is removed.
// savingsKindFor() tags each rec so a dashboard can total them separately.
//
// A1: rightsize savings are PER-POD × replicas — the earlier code dropped the
//     replica multiplier and understated multi-replica workloads.

import { HOURS_PER_MONTH } from "./currentCost.js";

export type SavingsKind = "realized" | "waste";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Waste $ from shrinking a per-pod request, across every replica of the workload. */
export function rightsizeMonthlyUsd(
  currentPerPod: number,
  proposedPerPod: number,
  replicas: number,
  perUnitHrUsd: number,
): number {
  const freed = Math.max(0, currentPerPod - proposedPerPod) * Math.max(0, replicas);
  return round4(freed * perUnitHrUsd * HOURS_PER_MONTH);
}

/** Waste $ from removing replicas — each removed pod frees its full request. */
export function replicaMonthlyUsd(
  currentReplicas: number,
  proposedReplicas: number,
  cpuRequestM: number,
  memRequestBytes: number,
  perMCpuHrUsd: number,
  perByteHrUsd: number,
): number {
  const removed = Math.max(0, currentReplicas - proposedReplicas);
  const perPodHrUsd = cpuRequestM * perMCpuHrUsd + memRequestBytes * perByteHrUsd;
  return round4(removed * perPodHrUsd * HOURS_PER_MONTH);
}

/** Realized $ from reclaiming a volume's storage. */
export function storageMonthlyUsd(bytes: number, perGbMonthUsd: number): number {
  return round4((bytes / 1e9) * perGbMonthUsd);
}

/** Which dollar bucket a recommendation type belongs to (null = we don't price it). */
export function savingsKindFor(type: string): SavingsKind | null {
  switch (type) {
    case "node-consolidate": // a drained node = real money
    case "pvc-cleanup": // a deleted volume = real money
      return "realized";
    case "cpu-rightsize":
    case "memory-rightsize":
    case "replica-optimize":
      return "waste";
    default: // cleanup (zero-traffic/stale workload) — no defensible $ yet
      return null;
  }
}
