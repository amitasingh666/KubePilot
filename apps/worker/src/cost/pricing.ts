// Stage C — effective-price resolver.
//
// Turns a node's identity (provider / region / instanceType / capacity type)
// into an effective $/hr, resolved on top of the global catalog:
//   1. a matching tenant PriceOverride wins (absolute rate, or a % off catalog)
//   2. otherwise the catalog price for the node's capacity type
//   3. spot with no spot row falls back to on-demand (flagged, not silent)
// Pure and DB-free so it unit-tests without Postgres; loadPricing.ts feeds it.

export type CapacityType = "on-demand" | "spot";

/** A node reduced to just what pricing needs. */
export type NodePriceInput = {
  provider: string | null;
  region: string | null;
  instanceType: string | null;
  capacityType: CapacityType;
  nodeGroup?: string | null;
  clusterId?: string | null;
};

/** One row of the global price catalog (InstancePrice), money already → number. */
export type CatalogPrice = {
  provider: string;
  region: string;
  instanceType: string;
  capacityType: string; // on-demand | spot
  source: string; // list | billing
  pricePerHourUsd: number;
  vcpu?: number | null; // known capacity for the instance type…
  memMib?: number | null; // …used as a fallback when a node lacks allocatable data
};

/** One tenant PriceOverride, money already → number. */
export type Override = {
  id: string;
  scope: "instance_type" | "node_group" | "cluster";
  provider: string | null; // null = any
  region: string | null; // null = any
  instanceType: string | null;
  nodeGroup: string | null;
  clusterId: string | null;
  pricePerHourUsd: number | null; // absolute rate…
  discountPct: number | null; // …or a fraction (0..1) off the catalog price
};

export type PriceBasis =
  | "override-absolute"
  | "override-discount"
  | "catalog-spot"
  | "catalog-on-demand"
  | "catalog-fallback-on-demand" // node is spot but only on-demand priced
  | "unpriced";

export type PriceResolution = {
  pricePerHourUsd: number | null; // null → could not be priced
  basis: PriceBasis;
  matchedOverrideId?: string;
  note: string;
  // The matched instance type's known capacity (from the catalog), for use as a
  // fallback when the node's own allocatable capacity is missing. null if unknown.
  capacityCpuM?: number | null;
  capacityMemBytes?: number | null;
};

// Billing-derived prices are more authoritative than published list prices.
const SOURCE_RANK: Record<string, number> = { billing: 2, list: 1 };

/** A catalog row applies to this node if provider/region/instanceType/capacity all match. */
function catalogMatches(p: CatalogPrice, node: NodePriceInput, capacity: CapacityType): boolean {
  return (
    p.provider === node.provider &&
    p.region === node.region &&
    p.instanceType === node.instanceType &&
    p.capacityType === capacity
  );
}

/** Best catalog price for a capacity type = highest-ranked source (billing > list). */
function bestCatalogPrice(
  catalog: CatalogPrice[],
  node: NodePriceInput,
  capacity: CapacityType,
): CatalogPrice | null {
  let best: CatalogPrice | null = null;
  for (const p of catalog) {
    if (!catalogMatches(p, node, capacity)) continue;
    if (!best || (SOURCE_RANK[p.source] ?? 0) > (SOURCE_RANK[best.source] ?? 0)) best = p;
  }
  return best;
}

// null on the override's provider/region means "any", so it matches anything.
function wild(overrideValue: string | null, nodeValue: string | null): boolean {
  return overrideValue == null || overrideValue === nodeValue;
}

/** Does this override target this node? (scope decides which key must match.) */
function overrideMatches(o: Override, node: NodePriceInput): boolean {
  if (!wild(o.provider, node.provider) || !wild(o.region, node.region)) return false;
  switch (o.scope) {
    case "cluster":
      return o.clusterId != null && o.clusterId === node.clusterId;
    case "node_group":
      return o.nodeGroup != null && o.nodeGroup === node.nodeGroup;
    case "instance_type":
      return o.instanceType != null && o.instanceType === node.instanceType;
  }
}

// More specific overrides win: cluster > node_group > instance_type.
const SCOPE_RANK: Record<Override["scope"], number> = {
  cluster: 3,
  node_group: 2,
  instance_type: 1,
};

function mostSpecificOverride(overrides: Override[], node: NodePriceInput): Override | null {
  let best: Override | null = null;
  for (const o of overrides) {
    if (!overrideMatches(o, node)) continue;
    if (!best || SCOPE_RANK[o.scope] > SCOPE_RANK[best.scope]) best = o;
  }
  return best;
}

/**
 * Resolve a node's effective $/hr. `overrides` should already be scoped to the
 * node's tenant (loadPricing does that). Returns a null price only when nothing
 * — no override, no catalog row — can price the node.
 */
export function resolveNodePrice(
  node: NodePriceInput,
  catalog: CatalogPrice[],
  overrides: Override[] = [],
): PriceResolution {
  const override = mostSpecificOverride(overrides, node);

  // Catalog price for the node's own capacity type, with spot→on-demand fallback.
  // Computed up front so the matched instance's capacity is available regardless
  // of which pricing branch we take.
  const wantSpot = node.capacityType === "spot";
  let base = bestCatalogPrice(catalog, node, node.capacityType);
  let basis: PriceBasis = wantSpot ? "catalog-spot" : "catalog-on-demand";
  if (!base && wantSpot) {
    base = bestCatalogPrice(catalog, node, "on-demand");
    basis = "catalog-fallback-on-demand";
  }
  const capacity = catalogCapacity(base);

  // 1. Absolute override rate — trust it as-is.
  if (override?.pricePerHourUsd != null) {
    return {
      pricePerHourUsd: override.pricePerHourUsd,
      basis: "override-absolute",
      matchedOverrideId: override.id,
      note: `override (${override.scope}) pins $${override.pricePerHourUsd}/hr`,
      ...capacity,
    };
  }

  // 2. Percentage override — needs a catalog base to discount from.
  if (override?.discountPct != null) {
    if (!base) {
      return {
        pricePerHourUsd: null,
        basis: "unpriced",
        matchedOverrideId: override.id,
        note: `discount override (${override.scope}) but no catalog price to apply it to`,
      };
    }
    const price = round6(base.pricePerHourUsd * (1 - override.discountPct));
    return {
      pricePerHourUsd: price,
      basis: "override-discount",
      matchedOverrideId: override.id,
      note: `${Math.round(override.discountPct * 100)}% off ${base.source} $${base.pricePerHourUsd}/hr`,
      ...capacity,
    };
  }

  // 3. Plain catalog price.
  if (base) {
    return {
      pricePerHourUsd: base.pricePerHourUsd,
      basis,
      note:
        basis === "catalog-fallback-on-demand"
          ? `spot node priced at on-demand ${base.source} rate (no spot price) — cost overstated`
          : `${base.source} ${node.capacityType} rate`,
      ...capacity,
    };
  }

  // 4. Nothing could price it.
  return {
    pricePerHourUsd: null,
    basis: "unpriced",
    note: `no catalog price for ${node.provider}/${node.region}/${node.instanceType} (${node.capacityType})`,
  };
}

// The matched instance type's capacity, converted to the units nodes use
// (millicores, bytes). null when the catalog row carries no capacity data.
function catalogCapacity(base: CatalogPrice | null): {
  capacityCpuM: number | null;
  capacityMemBytes: number | null;
} {
  return {
    capacityCpuM: base?.vcpu != null ? base.vcpu * 1000 : null,
    capacityMemBytes: base?.memMib != null ? base.memMib * 1024 * 1024 : null,
  };
}

// Keep money at the catalog's 6-dp precision; avoids float dust in discounts.
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
