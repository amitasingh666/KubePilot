import { describe, it, expect, vi } from "vitest";
import { orphanedPvcRecs } from "./orphanedPvc.js";

function makePrisma(rows: unknown[]) {
  return { pvc: { findMany: vi.fn().mockResolvedValue(rows) } };
}

describe("orphanedPvcRecs", () => {
  it("flags bound-but-unmounted PVCs and only queries those", async () => {
    const prisma = makePrisma([
      { clusterId: "c1", namespace: "shop", name: "data-1", capacityBytes: 8n * 1024n ** 3n },
    ]);
    const recs = await orphanedPvcRecs(prisma as any, "t1");

    expect(recs).toHaveLength(1);
    expect(recs[0]!.type).toBe("pvc-cleanup");
    expect(recs[0]!.name).toBe("data-1");
    expect(recs[0]!.capacityBytes).toBe(Number(8n * 1024n ** 3n));
    expect(recs[0]!.confidence).toBe("low");
    // Must scope to bound + unmounted (the orphaned/billed-but-unused condition).
    expect((prisma.pvc.findMany.mock.calls[0]![0] as any).where).toMatchObject({
      tenantId: "t1",
      bound: true,
      mounted: false,
    });
  });

  it("returns nothing when there are no orphans", async () => {
    expect(await orphanedPvcRecs(makePrisma([]) as any, "t1")).toEqual([]);
  });
});
