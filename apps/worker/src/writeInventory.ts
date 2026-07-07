import { createHash } from "node:crypto";
import { Prisma } from "@kubepilot/db";
import type { Snapshot, ResourceQuantities } from "@kubepilot/contract";

// Byte fields are BigInt in Postgres, but arrive as plain numbers over JSON.
export function toBig(n: number | null | undefined): bigint | null {
  return n == null ? null : BigInt(n);
}

// Stable hash of the sizing-relevant spec fields → cheap change detection for
// the workload_revision history (D4).
function hashSpec(replicas: number | null | undefined, r: ResourceQuantities): string {
  const stable = JSON.stringify([
    replicas ?? null,
    r.cpuRequestMillicores ?? null,
    r.cpuLimitMillicores ?? null,
    r.memRequestBytes ?? null,
    r.memLimitBytes ?? null,
  ]);
  return createHash("sha256").update(stable).digest("hex");
}

// Prisma nullable Json fields don't accept a plain `null`. Use Prisma.DbNull
// (SQL NULL) when the value is absent, otherwise pass the value through.
export function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/**
 * Writes a snapshot's inventory into the current-state tables.
 * Runs inside a transaction (tx) so all writes commit/rollback together with
 * the ingestion_snapshot claim in the caller.
 *
 * Uses upserts keyed by each table's natural unique key, so re-ingesting the
 * same object updates it ("latest known state") instead of duplicating.
 */
export async function writeInventory(
  tx: Prisma.TransactionClient,
  tenantId: string,
  snapshot: Snapshot,
) {
  const inv = snapshot.inventory;
  if (!inv) return; // usage/events snapshots carry no inventory
  const clusterId = snapshot.clusterId;

  // --- nodes ---
  for (const n of inv.nodes) {
    const data = {
      nodeGroup: n.nodeGroup ?? null,
      instanceType: n.instanceType ?? null,
      capacityProvider: n.capacityProvider ?? null,
      cpuCapacityM: n.cpuCapacityMillicores ?? null,
      memCapacityBytes: toBig(n.memCapacityBytes),
      cpuAllocatableM: n.cpuAllocatableMillicores ?? null,
      memAllocatableBytes: toBig(n.memAllocatableBytes),
      taints: jsonOrNull(n.taints),
      labels: jsonOrNull(n.labels),
      status: n.status ?? null,
      lastSeenAt: new Date(),
    };
    await tx.node.upsert({
      where: { clusterId_name: { clusterId, name: n.name } },
      create: { tenantId, clusterId, name: n.name, ...data },
      update: data,
    });
  }

  // --- workloads (+ containers + scheduling constraint) ---
  for (const w of inv.workloads) {
    const r = w.resources;
    const key = { clusterId, namespace: w.namespace, name: w.name, kind: w.kind };

    // hash sizing fields, and read the PRIOR hash before the upsert
    // overwrites it, so we can tell whether the spec actually changed.
    const specHash = hashSpec(w.replicas, r);
    const existing = await tx.workload.findUnique({
      where: { clusterId_namespace_name_kind: key },
      select: { specHash: true },
    });

    const wData = {
      replicas: w.replicas ?? null,
      cpuRequestM: r.cpuRequestMillicores ?? null,
      cpuLimitM: r.cpuLimitMillicores ?? null,
      memRequestBytes: toBig(r.memRequestBytes),
      memLimitBytes: toBig(r.memLimitBytes),
      qosClass: w.qosClass ?? null,
      priorityClass: w.priorityClass ?? null,
      managedBy: w.managedBy,
      gitopsOwned: w.gitopsOwned,
      gitopsSource: jsonOrNull(w.gitopsSource),
      labels: jsonOrNull(w.labels),
      podLabels: jsonOrNull(w.podLabels),
      specHash,
      lastSeenAt: new Date(),
    };
    const workload = await tx.workload.upsert({
      where: { clusterId_namespace_name_kind: key },
      create: { tenantId, clusterId, namespace: w.namespace, name: w.name, kind: w.kind, ...wData },
      update: wData,
    });

    // D4: append a revision only when the spec is new or changed (append-only history).
    if (!existing || existing.specHash !== specHash) {
      await tx.workloadRevision.create({
        data: {
          tenantId,
          workloadId: workload.id,
          replicas: w.replicas ?? null,
          cpuRequestM: r.cpuRequestMillicores ?? null,
          cpuLimitM: r.cpuLimitMillicores ?? null,
          memRequestBytes: toBig(r.memRequestBytes),
          memLimitBytes: toBig(r.memLimitBytes),
          specHash,
        },
      });
    }

    // containers (one-to-many)
    for (const c of w.containers) {
      const cr = c.resources;
      const cData = {
        cpuRequestM: cr.cpuRequestMillicores ?? null,
        cpuLimitM: cr.cpuLimitMillicores ?? null,
        memRequestBytes: toBig(cr.memRequestBytes),
        memLimitBytes: toBig(cr.memLimitBytes),
      };
      await tx.containerSpec.upsert({
        where: { workloadId_container: { workloadId: workload.id, container: c.name } },
        create: { tenantId, workloadId: workload.id, container: c.name, ...cData },
        update: cData,
      });
    }

    // scheduling constraint (one-to-one)
    if (w.constraints) {
      const sc = w.constraints;
      const scData = {
        nodeSelector: jsonOrNull(sc.nodeSelector),
        affinity: jsonOrNull(sc.affinity),
        antiAffinity: jsonOrNull(sc.antiAffinity),
        tolerations: jsonOrNull(sc.tolerations),
        topologySpread: jsonOrNull(sc.topologySpread),
        pvcAffinity: jsonOrNull(sc.pvcAffinity),
      };
      await tx.schedulingConstraint.upsert({
        where: { workloadId: workload.id },
        create: { tenantId, workloadId: workload.id, ...scData },
        update: scData,
      });
    }
  }

  // --- pod disruption budgets ---
  for (const p of inv.pdbs) {
    const data = {
      minAvailable: p.minAvailable ?? null,
      maxUnavailable: p.maxUnavailable ?? null,
      selector: jsonOrNull(p.selector),
      lastSeenAt: new Date(),
    };
    await tx.podDisruptionBudget.upsert({
      where: { clusterId_namespace_name: { clusterId, namespace: p.namespace, name: p.name } },
      create: { tenantId, clusterId, namespace: p.namespace, name: p.name, ...data },
      update: data,
    });
  }

  // --- pvcs ---
  for (const v of inv.pvcs) {
    const data = {
      storageClass: v.storageClass ?? null,
      capacityBytes: toBig(v.capacityBytes),
      volumeType: v.volumeType ?? null,
      bound: v.bound ?? null,
      mounted: v.mounted ?? null,
      lastSeenAt: new Date(),
    };
    await tx.pvc.upsert({
      where: { clusterId_namespace_name: { clusterId, namespace: v.namespace, name: v.name } },
      create: { tenantId, clusterId, namespace: v.namespace, name: v.name, ...data },
      update: data,
    });
  }

  // --- services ---
  for (const s of inv.services) {
    const data = {
      type: s.type ?? null,
      hasTraffic: s.hasTraffic ?? null,
      lastSeenAt: new Date(),
    };
    await tx.k8sService.upsert({
      where: { clusterId_namespace_name: { clusterId, namespace: s.namespace, name: s.name } },
      create: { tenantId, clusterId, namespace: s.namespace, name: s.name, ...data },
      update: data,
    });
  }

  // --- autoscalers ---
  // No natural unique key in the schema yet (the contract sends the target
  // workload name, not the autoscaler's own name). Simplest correct approach:
  // replace the cluster's autoscaler set each snapshot. Best-effort link to the
  // target workload id (null if that workload hasn't been ingested yet).
  await tx.autoscaler.deleteMany({ where: { clusterId } });
  for (const a of inv.autoscalers) {
    const target = await tx.workload.findFirst({
      where: { clusterId, namespace: a.namespace, name: a.targetWorkload },
      select: { id: true },
    });
    await tx.autoscaler.create({
      data: {
        tenantId,
        clusterId,
        workloadId: target?.id ?? null,
        kind: a.kind,
        minReplicas: a.minReplicas ?? null,
        maxReplicas: a.maxReplicas ?? null,
        metric: a.metric ?? null,
        target: jsonOrNull(a.target),
        updateMode: a.updateMode ?? null,
      },
    });
  }
}
