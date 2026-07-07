import type { PrismaClient } from "@kubepilot/db";
import { simulateCluster, type SimNode, type SimPod } from "../binpack.js";

// Pack against this fraction of allocatable, leaving a scheduling buffer.
const BINPACK_BUFFER = Number(process.env.BINPACK_BUFFER ?? 0.85);

export type NodeConsolidationRecommendation = {
  type: "node-consolidate";
  clusterId: string;
  clusterName: string;
  currentNodes: number;
  proposedNodes: number;
  reclaimableNodes: number;
  confidence: "low"; // always advisory — capacity upper-bound estimate (constraints deferred)
  rationale: string;
};

const num = (v: number | bigint | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * Per-cluster bin-packing estimate. Reserves DaemonSet per-node overhead, packs
 * the remaining pods (at current requests) via FFD, and flags clusters whose pods
 * would fit on fewer nodes. Advisory upper-bound only (see binpack.ts scope note).
 */
export async function nodeConsolidationRecs(
  prisma: PrismaClient,
  tenantId: string,
): Promise<NodeConsolidationRecommendation[]> {
  const clusters = await prisma.cluster.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });

  const recs: NodeConsolidationRecommendation[] = [];

  for (const cluster of clusters) {
    const [nodes, workloads] = await Promise.all([
      prisma.node.findMany({
        where: { clusterId: cluster.id },
        select: { cpuAllocatableM: true, memAllocatableBytes: true },
      }),
      prisma.workload.findMany({
        where: { clusterId: cluster.id },
        select: { kind: true, replicas: true, cpuRequestM: true, memRequestBytes: true },
      }),
    ]);
    if (nodes.length === 0) continue;

    // DaemonSets run one pod on every node → reserve their per-pod request on each node.
    const dsCpu = workloads.filter((w) => w.kind === "daemonset").reduce((s, w) => s + num(w.cpuRequestM), 0);
    const dsMem = workloads.filter((w) => w.kind === "daemonset").reduce((s, w) => s + num(w.memRequestBytes), 0);

    // Effective per-node capacity = allocatable × buffer − DaemonSet overhead (clamped ≥ 0).
    const simNodes: SimNode[] = nodes.map((n) => ({
      cpuM: Math.max(0, num(n.cpuAllocatableM) * BINPACK_BUFFER - dsCpu),
      memBytes: Math.max(0, num(n.memAllocatableBytes) * BINPACK_BUFFER - dsMem),
    }));

    // Non-DaemonSet workloads → one SimPod per replica at its current request.
    const pods: SimPod[] = [];
    for (const w of workloads) {
      if (w.kind === "daemonset") continue;
      const replicas = w.replicas ?? 0;
      for (let i = 0; i < replicas; i++) {
        pods.push({ cpuM: num(w.cpuRequestM), memBytes: num(w.memRequestBytes) });
      }
    }

    const sim = simulateCluster(simNodes, pods);
    if (sim.reclaimable > 0) {
      recs.push({
        type: "node-consolidate",
        clusterId: cluster.id,
        clusterName: cluster.name,
        currentNodes: sim.totalNodes,
        proposedNodes: sim.nodesNeeded,
        reclaimableNodes: sim.reclaimable,
        confidence: "low",
        rationale:
          `Pods fit on ~${sim.nodesNeeded} of ${sim.totalNodes} nodes at current requests ` +
          `(${Math.round(BINPACK_BUFFER * 100)}% buffer, DaemonSet overhead reserved) → up to ` +
          `${sim.reclaimable} node(s) reclaimable. Capacity estimate only — verify affinity/taints/` +
          `topology-spread/PVCs/PDBs before draining; real reclaim may be lower.`,
      });
    }
  }

  return recs;
}
