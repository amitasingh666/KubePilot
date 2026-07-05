
// Downgrades clusters that have gone quiet. Runs on a schedule (see index.ts).
import { PrismaClient } from "@kubepilot/db";

const STALE_AFTER_MS = Number(process.env.CLUSTER_STALE_AFTER_MS ?? 15 * 60_000);      // 15 min
const DISCONNECT_AFTER_MS = Number(process.env.CLUSTER_DISCONNECT_AFTER_MS ?? 60 * 60_000); // 1 hour

/** Mark quiet clusters stale/disconnected based on lastSeenAt. Returns how many changed. */
export async function sweepStaleClusters(
  prisma: PrismaClient,
  now: Date,
): Promise<{ stale: number; disconnected: number }> {
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const disconnectCutoff = new Date(now.getTime() - DISCONNECT_AFTER_MS);

  const disconnectedResult = await prisma.cluster.updateMany({
    where: {
      status: { in: ["connected", "stale"] },
      lastSeenAt: { lt: disconnectCutoff },
    },
    data: { status: "disconnected" },
  });

  const staleResult = await prisma.cluster.updateMany({
    where: {
      status: "connected",
      lastSeenAt: { lt: staleCutoff },
    },
    data: { status: "stale" },
  });

  return { stale: staleResult.count, disconnected: disconnectedResult.count };
}