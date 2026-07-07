// Phase 5 — feedback runner (DB layer). Loads each workload's revision history +
// stability events, detects applied optimizations, and upserts them into
// optimization_outcome (idempotent on workloadId+resource+detectedAt).
import type { PrismaClient } from "@kubepilot/db";
import { detectOutcomes, type Revision, type StabilityEvent } from "./feedback.js";

export async function runFeedback(prisma: PrismaClient, tenantId: string): Promise<number> {
  const workloads = await prisma.workload.findMany({
    where: { tenantId },
    select: { id: true, clusterId: true },
  });

  let detected = 0;
  for (const w of workloads) {
    const revisions = await prisma.workloadRevision.findMany({
      where: { workloadId: w.id },
      orderBy: { observedAt: "asc" },
      select: { observedAt: true, cpuRequestM: true, memRequestBytes: true, replicas: true },
    });
    if (revisions.length < 2) continue; // need a before/after to see a change

    // Stability events (OOMKill/restart) are on a Timescale hypertable — raw query.
    const events = await prisma.$queryRaw<{ ts: Date; kind: string }[]>`
      SELECT ts, kind FROM stability_event WHERE workload_id = ${w.id}::uuid
    `;

    const revs: Revision[] = revisions.map((r) => ({
      observedAt: r.observedAt,
      cpuRequestM: r.cpuRequestM,
      memRequestBytes: r.memRequestBytes == null ? null : Number(r.memRequestBytes),
      replicas: r.replicas,
    }));
    const evs: StabilityEvent[] = events.map((e) => ({ ts: e.ts, kind: e.kind }));

    for (const o of detectOutcomes(revs, evs)) {
      await prisma.optimizationOutcome.upsert({
        where: { workloadId_resource_detectedAt: { workloadId: w.id, resource: o.resource, detectedAt: o.detectedAt } },
        create: {
          tenantId, clusterId: w.clusterId, workloadId: w.id, resource: o.resource,
          fromValue: BigInt(Math.round(o.fromValue)), toValue: BigInt(Math.round(o.toValue)),
          detectedAt: o.detectedAt, safe: o.safe, note: o.note,
        },
        update: { safe: o.safe, note: o.note }, // re-evaluate safety as more events arrive
      });
      detected++;
    }
  }
  return detected;
}
