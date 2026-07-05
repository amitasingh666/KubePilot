import { describe, it, expect, vi } from "vitest";
import { sweepStaleClusters } from "./staleSweep.js";

// A Prisma stub with just cluster.updateMany. The two calls (disconnected, then
// stale) return distinct counts so we can tell them apart.
function makePrisma() {
  return {
    cluster: {
      updateMany: vi
        .fn()
        .mockResolvedValueOnce({ count: 2 }) // 1st call = disconnected
        .mockResolvedValueOnce({ count: 3 }), // 2nd call = stale
    },
  };
}

describe("sweepStaleClusters", () => {
  it("marks disconnected first, then stale, and returns both counts", async () => {
    const prisma = makePrisma();
    const now = new Date("2026-01-01T12:00:00.000Z");

    const result = await sweepStaleClusters(prisma as any, now);

    expect(result).toEqual({ stale: 3, disconnected: 2 });
    expect(prisma.cluster.updateMany).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = prisma.cluster.updateMany.mock.calls;
    // 1st = disconnected: targets both connected AND stale clusters
    expect(firstCall![0].data.status).toBe("disconnected");
    expect(firstCall![0].where.status).toEqual({ in: ["connected", "stale"] });
    // 2nd = stale: targets only still-connected clusters
    expect(secondCall![0].data.status).toBe("stale");
    expect(secondCall![0].where.status).toBe("connected");
  });

  it("uses the longer window for disconnect than for stale", async () => {
    const prisma = makePrisma();
    const now = new Date("2026-01-01T12:00:00.000Z");

    await sweepStaleClusters(prisma as any, now);

    const [firstCall, secondCall] = prisma.cluster.updateMany.mock.calls;
    const disconnectCutoff = firstCall![0].where.lastSeenAt.lt as Date;
    const staleCutoff = secondCall![0].where.lastSeenAt.lt as Date;
    // disconnect cutoff is further in the past (older) than stale cutoff
    expect(disconnectCutoff.getTime()).toBeLessThan(staleCutoff.getTime());
    // both are before "now"
    expect(staleCutoff.getTime()).toBeLessThan(now.getTime());
  });
});
