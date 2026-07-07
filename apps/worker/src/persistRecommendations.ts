import type { PrismaClient } from "@kubepilot/db";
import type { Recommendation } from "./rules/cpuRightsizing.js";
import type { MemRecommendation } from "./rules/memoryRightsizing.js";
import type { ReplicaRecommendation } from "./rules/replicaOptimization.js";
import type { CleanupRecommendation } from "./rules/unusedCleanup.js";
import type { NodeConsolidationRecommendation } from "./rules/nodeConsolidation.js";
import type { PvcCleanupRecommendation } from "./rules/orphanedPvc.js";
import { buildPatch } from "./patches.js";

// The discriminated union of everything a rule can emit. Add a rule → add its
// type here, and the toRow() switch below will force you to handle it.
export type AnyRecommendation =
  | Recommendation
  | MemRecommendation
  | ReplicaRecommendation
  | CleanupRecommendation
  | NodeConsolidationRecommendation
  | PvcCleanupRecommendation;

// The row shape we insert (BigInt holds millicores, bytes, or a count).
type RecRow = {
  tenantId: string;
  planId: string;
  workloadId: string | null; // null for node/pvc/cluster-scoped recs
  targetKind: string; // workload | node | pvc | cluster
  targetName: string | null;
  targetNamespace: string | null;
  type: string;
  resource: "cpu" | "memory" | "replicas" | "workload" | "nodes" | "storage";
  unit: "millicores" | "bytes" | "count";
  currentValue: bigint;
  proposedValue: bigint;
  savings: bigint;
  confidence: string;
  rationale: string;
  patch: string | null;
  patchMode: string | null;
};

// Normalize any recommendation → a DB row, dispatching on the `type` discriminant.
function toRow(
  tenantId: string,
  rec: AnyRecommendation,
  planId: string,
  gitopsByWorkload: Map<string, boolean>,
): RecRow {
  const gitops =
    "workloadId" in rec && rec.workloadId != null ? (gitopsByWorkload.get(rec.workloadId) ?? false) : false;
  const p = buildPatch(rec, gitops);
  const base = {
    tenantId,
    planId,
    type: rec.type,
    confidence: rec.confidence,
    rationale: rec.rationale,
    patch: p?.patch ?? null,
    patchMode: p?.patchMode ?? null,
  };
  // Target descriptor for the workload-scoped rec types (all but node-consolidate).
  const wl = (r: { workloadId: string; namespace: string; name: string }) => ({
    workloadId: r.workloadId,
    targetKind: "workload",
    targetName: r.name,
    targetNamespace: r.namespace,
  });
  switch (rec.type) {
    case "cpu-rightsize":
      return { ...base, ...wl(rec), resource: "cpu", unit: "millicores",
        currentValue: BigInt(rec.currentCpuM), proposedValue: BigInt(rec.proposedCpuM), savings: BigInt(rec.savingsM) };
    case "memory-rightsize":
      return { ...base, ...wl(rec), resource: "memory", unit: "bytes",
        currentValue: BigInt(rec.currentMemBytes), proposedValue: BigInt(rec.proposedMemBytes), savings: BigInt(rec.savingsBytes) };
    case "replica-optimize":
      return { ...base, ...wl(rec), resource: "replicas", unit: "count",
        currentValue: BigInt(rec.currentReplicas), proposedValue: BigInt(rec.proposedReplicas), savings: BigInt(rec.currentReplicas - rec.proposedReplicas) };
    case "cleanup":
      // A "consider removing" flag — no numeric target; savings priced later (Phase 3).
      return { ...base, ...wl(rec), resource: "workload", unit: "count",
        currentValue: BigInt(rec.currentReplicas), proposedValue: 0n, savings: 0n };
    case "node-consolidate":
      // Cluster-scoped: no workload; target is the cluster.
      return { ...base, workloadId: null, targetKind: "cluster", targetName: rec.clusterName, targetNamespace: null,
        resource: "nodes", unit: "count",
        currentValue: BigInt(rec.currentNodes), proposedValue: BigInt(rec.proposedNodes), savings: BigInt(rec.reclaimableNodes) };
    case "pvc-cleanup":
      // PVC-scoped: no workload; target is the PVC. Propose reclaiming its storage.
      return { ...base, workloadId: null, targetKind: "pvc", targetName: rec.name, targetNamespace: rec.namespace,
        resource: "storage", unit: "bytes",
        currentValue: BigInt(rec.capacityBytes), proposedValue: 0n, savings: BigInt(rec.capacityBytes) };
    default: {
      // Exhaustiveness: adding a new rec type without a case above is a compile error.
      const _exhaustive: never = rec;
      throw new Error(`unhandled recommendation type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Reconcile a tenant's recommendations into one OptimizationPlan and persist them,
 * atomically. delete-all + insert → the stored set always reflects the latest run.
 * The plan's confidence is "high" only if every rec is high-confidence.
 * (Trade-off: per-rec status isn't preserved across runs — a Phase 5 concern.)
 */
export async function persistRecommendations(
  prisma: PrismaClient,
  tenantId: string,
  recs: AnyRecommendation[],
  gitopsByWorkload: Map<string, boolean>,
): Promise<number> {
  const confidence = recs.length > 0 && recs.every((r) => r.confidence === "high") ? "high" : "low";

  await prisma.$transaction(async (tx) => {
    await tx.recommendation.deleteMany({ where: { tenantId } });
    await tx.optimizationPlan.deleteMany({ where: { tenantId } });
    if (recs.length === 0) return;

    const plan = await tx.optimizationPlan.create({
      data: { tenantId, recCount: recs.length, confidence },
    });
    const rows = recs.map((r) => toRow(tenantId, r, plan.id, gitopsByWorkload));
    await tx.recommendation.createMany({ data: rows });
  });

  return recs.length;
}
