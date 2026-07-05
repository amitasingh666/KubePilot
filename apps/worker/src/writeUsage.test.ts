import { describe, it, expect, vi } from "vitest";
import { writeUsage } from "./writeUsage.js";
import type { Snapshot } from "@kubepilot/contract";

// A hand-rolled Prisma transaction-client stub with just the methods writeUsage
// touches. We assert on how it's called — no real DB involved.
function makeTx() {
  return {
    workload: { upsert: vi.fn().mockResolvedValue({ id: "wl-1" }) },
    usageMetricWorkload: { upsert: vi.fn().mockResolvedValue({}) },
    node: { findUnique: vi.fn().mockResolvedValue(null) },
    usageMetricNode: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

const usageSnapshot = {
  clusterId: "11111111-1111-1111-1111-111111111111",
  usage: {
    workloads: [
      {
        namespace: "shop",
        workload: "checkout",
        kind: "deployment",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-01T00:30:00.000Z",
        windowSec: 1800,
        cpuP95Millicores: 120,
        memMaxBytes: 34567,
        restarts: 0,
      },
    ],
    nodes: [],
  },
} as unknown as Snapshot;

describe("writeUsage (Fix 2: upsert stub, never silently skip)", () => {
  it("upserts the workload and writes the usage row even when inventory is absent", async () => {
    const tx = makeTx();
    await writeUsage(tx as any, "tenant-1", usageSnapshot);

    // The workload is upserted (a stub is created if missing) — not skipped.
    expect(tx.workload.upsert).toHaveBeenCalledTimes(1);
    const arg = tx.workload.upsert.mock.calls[0]![0];
    expect(arg.where.clusterId_namespace_name_kind).toMatchObject({
      clusterId: usageSnapshot.clusterId,
      namespace: "shop",
      name: "checkout",
      kind: "deployment",
    });
    expect(arg.create).toMatchObject({
      tenantId: "tenant-1",
      clusterId: usageSnapshot.clusterId,
      namespace: "shop",
      name: "checkout",
      kind: "deployment",
    });

    // The usage sample is actually persisted (this was 0 before the fix).
    expect(tx.usageMetricWorkload.upsert).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the snapshot carries no usage payload", async () => {
    const tx = makeTx();
    await writeUsage(tx as any, "tenant-1", { clusterId: "x" } as unknown as Snapshot);
    expect(tx.workload.upsert).not.toHaveBeenCalled();
  });
});
