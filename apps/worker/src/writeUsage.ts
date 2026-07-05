import { Prisma } from "@kubepilot/db";
import type { Snapshot } from "@kubepilot/contract";
import { toBig, jsonOrNull } from "./writeInventory.js";

/**
 * Writes a snapshot's usage payload into the Timescale hypertables.
 * Usage identifies targets by name (namespace/name/kind for workloads, name for
 * nodes), so we resolve our internal ids first. Runs inside the same
 * transaction as the ingestion_snapshot claim.
 */
export async function writeUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  snapshot: Snapshot,
) {
  const u = snapshot.usage;
  if (!u) return;
  const clusterId = snapshot.clusterId;

  // --- workload usage ---
  for (const wu of u.workloads) {
    // Resolve the workload id, creating a minimal stub if inventory hasn't landed
    // yet. Inventory and usage are independent jobs with no ordering guarantee, so
    // a brand-new cluster's first usage snapshot can arrive before its inventory —
    // without this, that first sample would be silently dropped. A later inventory
    // push enriches the stub (upsert on the same unique key).
    const wl = await tx.workload.upsert({
      where: {
        clusterId_namespace_name_kind: {
          clusterId,
          namespace: wu.namespace,
          name: wu.workload,
          kind: wu.kind,
        },
      },
      create: {
        tenantId,
        clusterId,
        namespace: wu.namespace,
        name: wu.workload,
        kind: wu.kind,
      },
      update: {},
      select: { id: true },
    });

    const ts = new Date(wu.windowEnd);
    const data = {
      tenantId,
      clusterId,
      workloadId: wl.id,
      ts,
      windowSec: wu.windowSec,
      cpuP95M: wu.cpuP95Millicores,
      cpuAvgM: wu.cpuAvgMillicores ?? null,
      memMaxBytes: toBig(wu.memMaxBytes),
      memAvgBytes: toBig(wu.memAvgBytes),
      restarts: wu.restarts,
    };
    await tx.usageMetricWorkload.upsert({
      where: { workloadId_ts_windowSec: { workloadId: wl.id, ts, windowSec: wu.windowSec } },
      create: data,
      update: data,
    });
  }

  // --- node usage ---
  for (const nu of u.nodes) {
    const nd = await tx.node.findUnique({
      where: { clusterId_name: { clusterId, name: nu.node } },
      select: { id: true },
    });
    if (!nd) continue;

    const ts = new Date(nu.windowEnd);
    const data = {
      tenantId,
      clusterId,
      nodeId: nd.id,
      ts,
      windowSec: nu.windowSec,
      cpuUsedM: nu.cpuUsedMillicores ?? null,
      memUsedBytes: toBig(nu.memUsedBytes),
      cpuAllocPct: nu.cpuAllocatablePct ?? null,
      memAllocPct: nu.memAllocatablePct ?? null,
    };
    await tx.usageMetricNode.upsert({
      where: { nodeId_ts_windowSec: { nodeId: nd.id, ts, windowSec: nu.windowSec } },
      create: data,
      update: data,
    });
  }
}

/**
 * Appends stability events (OOMkills / restarts / evictions) to the event log.
 * Append-only: each event is its own row (create, not upsert). Best-effort link
 * to a workload id (null if the event doesn't map to one).
 */
export async function writeEvents(
  tx: Prisma.TransactionClient,
  tenantId: string,
  snapshot: Snapshot,
) {
  const e = snapshot.events;
  if (!e) return;
  const clusterId = snapshot.clusterId;

  for (const ev of e.events) {
    let workloadId: string | null = null;
    if (ev.namespace && ev.workload) {
      const wl = await tx.workload.findFirst({
        where: { clusterId, namespace: ev.namespace, name: ev.workload },
        select: { id: true },
      });
      workloadId = wl?.id ?? null;
    }
    await tx.stabilityEvent.create({
      data: {
        tenantId,
        clusterId,
        workloadId,
        ts: new Date(ev.ts),
        kind: ev.kind,
        detail: jsonOrNull(ev.detail),
      },
    });
  }
}
