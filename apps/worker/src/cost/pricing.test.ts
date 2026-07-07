import { describe, it, expect } from "vitest";
import {
  resolveNodePrice,
  type CatalogPrice,
  type NodePriceInput,
  type Override,
} from "./pricing.js";

// A small aws/us-east-1 catalog: m5.large on-demand + spot, m5.xlarge on-demand only.
const CATALOG: CatalogPrice[] = [
  { provider: "aws", region: "us-east-1", instanceType: "m5.large", capacityType: "on-demand", source: "list", pricePerHourUsd: 0.096 },
  { provider: "aws", region: "us-east-1", instanceType: "m5.large", capacityType: "spot", source: "list", pricePerHourUsd: 0.0296 },
  { provider: "aws", region: "us-east-1", instanceType: "m5.xlarge", capacityType: "on-demand", source: "list", pricePerHourUsd: 0.192 },
];

function node(over: Partial<NodePriceInput> = {}): NodePriceInput {
  return {
    provider: "aws",
    region: "us-east-1",
    instanceType: "m5.large",
    capacityType: "on-demand",
    nodeGroup: "default",
    clusterId: "c1",
    ...over,
  };
}

function override(over: Partial<Override> = {}): Override {
  return {
    id: "o1",
    scope: "instance_type",
    provider: null,
    region: null,
    instanceType: "m5.large",
    nodeGroup: null,
    clusterId: null,
    pricePerHourUsd: null,
    discountPct: null,
    ...over,
  };
}

describe("resolveNodePrice", () => {
  it("uses the on-demand catalog price by default", () => {
    const r = resolveNodePrice(node(), CATALOG);
    expect(r.pricePerHourUsd).toBe(0.096);
    expect(r.basis).toBe("catalog-on-demand");
  });

  it("uses the spot price for a spot node", () => {
    const r = resolveNodePrice(node({ capacityType: "spot" }), CATALOG);
    expect(r.pricePerHourUsd).toBe(0.0296);
    expect(r.basis).toBe("catalog-spot");
  });

  it("falls back to on-demand (flagged) when a spot node has no spot price", () => {
    const r = resolveNodePrice(node({ instanceType: "m5.xlarge", capacityType: "spot" }), CATALOG);
    expect(r.pricePerHourUsd).toBe(0.192);
    expect(r.basis).toBe("catalog-fallback-on-demand");
  });

  it("prefers a billing-sourced price over list", () => {
    const withBilling: CatalogPrice[] = [
      ...CATALOG,
      { provider: "aws", region: "us-east-1", instanceType: "m5.large", capacityType: "on-demand", source: "billing", pricePerHourUsd: 0.081 },
    ];
    expect(resolveNodePrice(node(), withBilling).pricePerHourUsd).toBe(0.081);
  });

  it("an absolute override wins over the catalog", () => {
    const r = resolveNodePrice(node(), CATALOG, [override({ pricePerHourUsd: 0.05 })]);
    expect(r.pricePerHourUsd).toBe(0.05);
    expect(r.basis).toBe("override-absolute");
    expect(r.matchedOverrideId).toBe("o1");
  });

  it("a discount override applies a % off the catalog price", () => {
    const r = resolveNodePrice(node(), CATALOG, [override({ discountPct: 0.25 })]);
    expect(r.pricePerHourUsd).toBe(0.072); // 0.096 * 0.75
    expect(r.basis).toBe("override-discount");
  });

  it("picks the most specific override (cluster > instance_type)", () => {
    const overrides = [
      override({ id: "byType", discountPct: 0.1 }),
      override({ id: "byCluster", scope: "cluster", instanceType: null, clusterId: "c1", pricePerHourUsd: 0.03 }),
    ];
    const r = resolveNodePrice(node(), CATALOG, overrides);
    expect(r.matchedOverrideId).toBe("byCluster");
    expect(r.pricePerHourUsd).toBe(0.03);
  });

  it("ignores overrides that don't target the node", () => {
    const r = resolveNodePrice(node(), CATALOG, [override({ instanceType: "c5.large", pricePerHourUsd: 0.01 })]);
    expect(r.pricePerHourUsd).toBe(0.096); // falls through to catalog
    expect(r.basis).toBe("catalog-on-demand");
  });

  it("exposes the matched instance type's capacity for fallback use", () => {
    const withCap: CatalogPrice[] = [
      { provider: "aws", region: "us-east-1", instanceType: "m5.large", capacityType: "on-demand", source: "list", pricePerHourUsd: 0.096, vcpu: 2, memMib: 8192 },
    ];
    const r = resolveNodePrice(node(), withCap);
    expect(r.capacityCpuM).toBe(2000); // 2 vCPU → 2000m
    expect(r.capacityMemBytes).toBe(8192 * 1024 * 1024);
  });

  it("returns unpriced when nothing in the catalog matches", () => {
    const r = resolveNodePrice(node({ instanceType: "unknown.type" }), CATALOG);
    expect(r.pricePerHourUsd).toBeNull();
    expect(r.basis).toBe("unpriced");
  });

  it("is unpriced when a discount override has no catalog base to apply to", () => {
    const r = resolveNodePrice(node({ instanceType: "unknown.type" }), CATALOG, [
      override({ instanceType: "unknown.type", discountPct: 0.5 }),
    ]);
    expect(r.pricePerHourUsd).toBeNull();
    expect(r.basis).toBe("unpriced");
  });
});
