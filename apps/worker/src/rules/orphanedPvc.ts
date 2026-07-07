import type { PrismaClient } from "@kubepilot/db";

export type PvcCleanupRecommendation = {
  type: "pvc-cleanup";
  clusterId: string;
  namespace: string;
  name: string;
  capacityBytes: number;
  confidence: "low"; // always advisory — deleting a PVC destroys data; a human must confirm
  rationale: string;
};

/**
 * Orphaned-PVC cleanup: a PVC that is BOUND (storage provisioned, being billed)
 * but MOUNTED by no pod — wasted storage spend. Unblocked by the agent's `mounted`
 * cross-reference (backfill Item A) + the recommendation target generalization.
 */
export async function orphanedPvcRecs(
  prisma: PrismaClient,
  tenantId: string,
): Promise<PvcCleanupRecommendation[]> {
  const orphans = await prisma.pvc.findMany({
    where: { tenantId, bound: true, mounted: false },
    select: { clusterId: true, namespace: true, name: true, capacityBytes: true },
  });

  return orphans.map((p) => {
    const bytes = p.capacityBytes == null ? 0 : Number(p.capacityBytes);
    const gi = Math.round(bytes / 1024 ** 3);
    return {
      type: "pvc-cleanup" as const,
      clusterId: p.clusterId,
      namespace: p.namespace,
      name: p.name,
      capacityBytes: bytes,
      confidence: "low" as const,
      rationale:
        `PVC is bound (${gi}Gi provisioned & billed) but mounted by no pod — likely orphaned. ` +
        `Confirm it's no longer needed before deleting: removing a PVC destroys its data.`,
    };
  });
}
