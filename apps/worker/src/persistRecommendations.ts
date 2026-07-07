import type { PrismaClient } from "@kubepilot/db";
import type { Recommendation } from "./rules/cpuRightsizing.js";
import type { MemRecommendation } from "./rules/memoryRightsizing.js";
import type { ReplicaRecommendation } from "./rules/replicaOptimization.js";
import type { CleanupRecommendation } from "./rules/unusedCleanup.js";

// The discriminated union of everything a rule can emit. Add a rule → add its
// type here, and the toRow() switch below will force you to handle it.
export type AnyRecommendation =
  | Recommendation
  | MemRecommendation
  | ReplicaRecommendation
  | CleanupRecommendation;

// The row shape we insert (BigInt holds millicores, bytes, or a replica count).
type RecRow = {
  tenantId: string;
  workloadId: string;
  type: string;
  resource: "cpu" | "memory" | "replicas" | "workload";
  unit: "millicores" | "bytes" | "count";
  currentValue: bigint;
  proposedValue: bigint;
  savings: bigint;
  confidence: string;
  rationale: string;
};

// Normalize any recommendation → a DB row, dispatching on the `type` discriminant.
function toRow(tenantId: string, rec: AnyRecommendation): RecRow {
  const base = {
    tenantId,
    workloadId: rec.workloadId,
    type: rec.type,
    confidence: rec.confidence,
    rationale: rec.rationale,
  };
  switch (rec.type) {
    case "cpu-rightsize":
      return { ...base, resource: "cpu", unit: "millicores",
        currentValue: BigInt(rec.currentCpuM), proposedValue: BigInt(rec.proposedCpuM), savings: BigInt(rec.savingsM) };
    case "memory-rightsize":
      return { ...base, resource: "memory", unit: "bytes",
        currentValue: BigInt(rec.currentMemBytes), proposedValue: BigInt(rec.proposedMemBytes), savings: BigInt(rec.savingsBytes) };
    case "replica-optimize":
      return { ...base, resource: "replicas", unit: "count",
        currentValue: BigInt(rec.currentReplicas), proposedValue: BigInt(rec.proposedReplicas), savings: BigInt(rec.currentReplicas - rec.proposedReplicas) };
    case "cleanup":
      // A "consider removing" flag — no numeric target; savings priced later (Phase 3).
      return { ...base, resource: "workload", unit: "count",
        currentValue: BigInt(rec.currentReplicas), proposedValue: 0n, savings: 0n };
    default: {
      // Exhaustiveness: adding a new rec type without a case above is a compile error.
      const _exhaustive: never = rec;
      throw new Error(`unhandled recommendation type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Replace a tenant's recommendations with the freshly-computed set, atomically.
 * delete-all + insert → the stored set always reflects the latest analysis run.
 * (Trade-off: per-rec status isn't preserved across runs — a Phase 5 concern.)
 */
export async function persistRecommendations(
  prisma: PrismaClient,
  tenantId: string,
  recs: AnyRecommendation[],
): Promise<number> {
  const rows: RecRow[] = recs.map((r) => toRow(tenantId, r));

  await prisma.$transaction(async (tx) => {
    await tx.recommendation.deleteMany({ where: { tenantId } });
    if (rows.length) await tx.recommendation.createMany({ data: rows });
  });

  return rows.length;
}
