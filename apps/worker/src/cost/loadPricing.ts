// Stage C — the DB half of pricing: load the catalog + a tenant's overrides,
// and map a stored Node into the pure resolver's NodePriceInput.
import type { PrismaClient } from "@kubepilot/db";
import type { CapacityType, CatalogPrice, NodePriceInput, Override } from "./pricing.js";

// Dev clusters (e.g. kind) report no provider/region; assume these so their
// nodes still price against the seeded catalog. Real clusters carry their own.
const DEFAULT_PROVIDER = process.env.COST_DEFAULT_PROVIDER ?? "aws";
const DEFAULT_REGION = process.env.COST_DEFAULT_REGION ?? "us-east-1";

export type Pricing = { catalog: CatalogPrice[]; overrides: Override[] };

/** Load the global instance-price catalog + this tenant's overrides. */
export async function loadPricing(prisma: PrismaClient, tenantId: string): Promise<Pricing> {
  const [rows, overrides] = await Promise.all([
    prisma.instancePrice.findMany({
      select: {
        provider: true,
        region: true,
        instanceType: true,
        capacityType: true,
        source: true,
        pricePerHourUsd: true,
        vcpu: true,
        memMib: true,
      },
    }),
    prisma.priceOverride.findMany({
      where: { tenantId },
      select: {
        id: true,
        scope: true,
        provider: true,
        region: true,
        instanceType: true,
        nodeGroup: true,
        clusterId: true,
        pricePerHourUsd: true,
        discountPct: true,
      },
    }),
  ]);

  const catalog: CatalogPrice[] = rows.map((r) => ({
    provider: r.provider,
    region: r.region,
    instanceType: r.instanceType,
    capacityType: r.capacityType,
    source: r.source,
    pricePerHourUsd: r.pricePerHourUsd.toNumber(),
    vcpu: r.vcpu,
    memMib: r.memMib == null ? null : Number(r.memMib),
  }));

  const mapped: Override[] = overrides.map((o) => ({
    id: o.id,
    scope: o.scope as Override["scope"],
    provider: o.provider,
    region: o.region,
    instanceType: o.instanceType,
    nodeGroup: o.nodeGroup,
    clusterId: o.clusterId,
    pricePerHourUsd: o.pricePerHourUsd?.toNumber() ?? null,
    discountPct: o.discountPct?.toNumber() ?? null,
  }));

  return { catalog, overrides: mapped };
}

// A node counts as spot if its capacity provider or the standard cloud labels
// say so (EKS: eks.amazonaws.com/capacityType=SPOT; Karpenter: karpenter.sh/capacity-type=spot).
export function deriveCapacityType(node: {
  capacityProvider: string | null;
  labels: unknown;
}): CapacityType {
  const hay = [
    node.capacityProvider ?? "",
    (node.labels as Record<string, string> | null)?.["eks.amazonaws.com/capacityType"] ?? "",
    (node.labels as Record<string, string> | null)?.["karpenter.sh/capacity-type"] ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes("spot") ? "spot" : "on-demand";
}

/**
 * Map a stored Node into the resolver's input. provider/region come from the
 * owning Cluster (Node has neither); dev defaults fill in when the cluster is
 * unlabelled (kind).
 */
export function toNodePriceInput(
  node: {
    clusterId: string;
    nodeGroup: string | null;
    instanceType: string | null;
    capacityProvider: string | null;
    labels: unknown;
  },
  cluster: { provider: string | null; region: string | null },
): NodePriceInput {
  return {
    provider: cluster.provider ?? DEFAULT_PROVIDER,
    region: cluster.region ?? DEFAULT_REGION,
    instanceType: node.instanceType,
    capacityType: deriveCapacityType(node),
    nodeGroup: node.nodeGroup,
    clusterId: node.clusterId,
  };
}
