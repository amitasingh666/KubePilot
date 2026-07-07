// Stage D — current-cost computation (pure).
//
// Nodes are what get billed, so cluster cost = Σ (node $/hr × 730). Kubernetes
// doesn't bill per-pod, so we ATTRIBUTE that cluster cost down to namespaces and
// workloads by each workload's share of total *requested* resources — a blended
// CPU/mem split (default 50/50). This is an estimate, not a metered bill; it's
// the standard approach when you lack per-pod node placement.

export const HOURS_PER_MONTH = 730; // 365 × 24 / 12, the cloud-billing convention

// Fraction of a node's cost attributed to CPU (rest → memory). Tunable.
const CPU_WEIGHT = Number(process.env.COST_CPU_WEIGHT ?? 0.5);

/** A node with its already-resolved effective price ($/hr). Unpriced → null. */
export type PricedNode = {
  cpuAllocatableM: number;
  memAllocatableBytes: number;
  pricePerHourUsd: number | null;
};

/** A workload as it currently runs (for cost attribution). */
export type CostWorkload = {
  workloadId: string;
  namespace: string;
  name: string;
  replicas: number;
  cpuRequestM: number;
  memRequestBytes: number;
};

export type WorkloadCost = {
  workloadId: string;
  namespace: string;
  name: string;
  monthlyUsd: number;
};

export type ClusterCost = {
  clusterMonthlyUsd: number;
  pricedNodeCount: number;
  unpricedNodeCount: number;
  // Per-unit blended rates, for pricing request deltas elsewhere (Stage E waste).
  perMCpuHrUsd: number;
  perByteHrUsd: number;
  namespaces: { name: string; monthlyUsd: number }[];
  workloads: WorkloadCost[];
};

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Compute a cluster's monthly cost and attribute it across workloads/namespaces.
 * Unpriced nodes contribute $0 (and are counted) rather than breaking the total.
 */
export function computeClusterCost(nodes: PricedNode[], workloads: CostWorkload[]): ClusterCost {
  const priced = nodes.filter((n) => n.pricePerHourUsd != null);
  const hourly = priced.reduce((s, n) => s + (n.pricePerHourUsd ?? 0), 0);
  const clusterMonthlyUsd = round4(hourly * HOURS_PER_MONTH);

  // Blended per-unit rates over the (priced) node pool's allocatable capacity.
  const totalCpuAlloc = priced.reduce((s, n) => s + n.cpuAllocatableM, 0);
  const totalMemAlloc = priced.reduce((s, n) => s + n.memAllocatableBytes, 0);
  const perMCpuHrUsd = totalCpuAlloc > 0 ? (hourly * CPU_WEIGHT) / totalCpuAlloc : 0;
  const perByteHrUsd = totalMemAlloc > 0 ? (hourly * (1 - CPU_WEIGHT)) / totalMemAlloc : 0;

  // Total requested resources across the cluster (replicas × per-pod request).
  const reqCpu = (w: CostWorkload) => w.replicas * w.cpuRequestM;
  const reqMem = (w: CostWorkload) => w.replicas * w.memRequestBytes;
  const totalReqCpu = workloads.reduce((s, w) => s + reqCpu(w), 0);
  const totalReqMem = workloads.reduce((s, w) => s + reqMem(w), 0);

  const workloadCosts: WorkloadCost[] = workloads.map((w) => {
    const cpuShare = totalReqCpu > 0 ? reqCpu(w) / totalReqCpu : 0;
    const memShare = totalReqMem > 0 ? reqMem(w) / totalReqMem : 0;
    const weight = CPU_WEIGHT * cpuShare + (1 - CPU_WEIGHT) * memShare;
    return {
      workloadId: w.workloadId,
      namespace: w.namespace,
      name: w.name,
      monthlyUsd: round4(weight * clusterMonthlyUsd),
    };
  });

  // Roll workloads up to namespaces.
  const byNs = new Map<string, number>();
  for (const wc of workloadCosts) byNs.set(wc.namespace, (byNs.get(wc.namespace) ?? 0) + wc.monthlyUsd);
  const namespaces = [...byNs.entries()]
    .map(([name, monthlyUsd]) => ({ name, monthlyUsd: round4(monthlyUsd) }))
    .sort((a, b) => b.monthlyUsd - a.monthlyUsd);

  return {
    clusterMonthlyUsd,
    pricedNodeCount: priced.length,
    unpricedNodeCount: nodes.length - priced.length,
    perMCpuHrUsd,
    perByteHrUsd,
    namespaces,
    workloads: workloadCosts,
  };
}
