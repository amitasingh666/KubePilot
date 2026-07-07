// Phase 3 orchestrator — the DB layer tying Stages D–G together for one tenant.
//   D: current cost per cluster/namespace/workload  → cost_breakdown rows
//   E: node-level realized vs waste savings          → optimization_plan $
//   F: realizability (auto vs manual)                → optimization_plan.realizability
//   + per-recommendation savings_usd
// Runs after persistRecommendations, off the freshly-written plan.
import type { PrismaClient } from "@kubepilot/db";
import { loadPricing, toNodePriceInput } from "./loadPricing.js";
import { resolveNodePrice } from "./pricing.js";
import { computeClusterCost, type CostWorkload, type PricedNode } from "./currentCost.js";
import {
  computeClusterSavings,
  rollupRealizability,
  type Realizability,
  type SavingsNode,
  type SavingsWorkload,
} from "./planSavings.js";
import {
  rightsizeMonthlyUsd,
  replicaMonthlyUsd,
  storageMonthlyUsd,
  savingsKindFor,
} from "./recPricing.js";

const DEFAULT_VOLUME_TYPE = process.env.COST_DEFAULT_VOLUME_TYPE ?? "gp3";
const DEFAULT_PROVIDER = process.env.COST_DEFAULT_PROVIDER ?? "aws";
const DEFAULT_REGION = process.env.COST_DEFAULT_REGION ?? "us-east-1";

const num = (v: number | bigint | null | undefined): number => (v == null ? 0 : Number(v));

type PerCluster = {
  perMCpuHrUsd: number;
  perByteHrUsd: number;
  realizedMonthlyUsd: number;
  realizability: Realizability;
};

/** Compute + persist all Phase 3 cost artifacts for one tenant. Returns a summary. */
export async function computeAndPersistCost(prisma: PrismaClient, tenantId: string) {
  const { catalog, overrides } = await loadPricing(prisma, tenantId);
  const storagePrices = await prisma.storagePrice.findMany({
    where: { source: "list" },
    select: { provider: true, region: true, volumeType: true, pricePerGbMonthUsd: true },
  });

  const clusters = await prisma.cluster.findMany({
    where: { tenantId },
    select: { id: true, name: true, provider: true, region: true, autoscaler: true },
  });

  // The latest plan + its recs (may be absent if a run produced none).
  const plan = await prisma.optimizationPlan.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const recs = plan
    ? await prisma.recommendation.findMany({
        where: { tenantId, planId: plan.id },
        select: {
          id: true, type: true, resource: true, workloadId: true,
          targetKind: true, targetName: true, currentValue: true, proposedValue: true,
        },
      })
    : [];

  // Proposed spec overrides per workload, distilled from the plan's recs.
  const proposedByWorkload = new Map<
    string,
    { cpuRequestM?: number; memRequestBytes?: number; replicas?: number }
  >();
  for (const r of recs) {
    if (!r.workloadId) continue;
    const p = proposedByWorkload.get(r.workloadId) ?? {};
    if (r.resource === "cpu") p.cpuRequestM = num(r.proposedValue);
    else if (r.resource === "memory") p.memRequestBytes = num(r.proposedValue);
    else if (r.resource === "replicas") p.replicas = num(r.proposedValue);
    proposedByWorkload.set(r.workloadId, p);
  }

  const breakdownRows: {
    tenantId: string; clusterId: string; scope: string;
    namespace: string | null; workloadId: string | null; name: string; monthlyUsd: number;
  }[] = [];
  const perClusterById = new Map<string, PerCluster>();
  const perClusterByName = new Map<string, PerCluster>();
  const perClusterList: { realizedMonthlyUsd: number; realizability: Realizability }[] = [];
  // workloadId → its cluster + current spec, for per-rec pricing (incl. replicas — A1).
  const workloadInfo = new Map<
    string,
    { clusterId: string; replicas: number; cpuRequestM: number; memRequestBytes: number }
  >();
  let wasteAccum = 0;

  for (const cluster of clusters) {
    const [nodes, workloads] = await Promise.all([
      prisma.node.findMany({
        where: { clusterId: cluster.id },
        select: {
          clusterId: true, nodeGroup: true, instanceType: true, capacityProvider: true,
          labels: true, cpuAllocatableM: true, memAllocatableBytes: true,
        },
      }),
      prisma.workload.findMany({
        where: { clusterId: cluster.id },
        select: {
          id: true, namespace: true, name: true, kind: true, replicas: true,
          cpuRequestM: true, memRequestBytes: true,
        },
      }),
    ]);
    if (nodes.length === 0) continue;

    // Price each node via the resolver (provider/region from the cluster). When a
    // node reports no allocatable capacity, fall back to the instance type's known
    // capacity from the catalog so per-unit cost attribution still works.
    const pricedNodes: PricedNode[] = nodes.map((n) => {
      const res = resolveNodePrice(
        toNodePriceInput(n, { provider: cluster.provider, region: cluster.region }),
        catalog,
        overrides,
      );
      return {
        cpuAllocatableM: num(n.cpuAllocatableM) || (res.capacityCpuM ?? 0),
        memAllocatableBytes: num(n.memAllocatableBytes) || (res.capacityMemBytes ?? 0),
        pricePerHourUsd: res.pricePerHourUsd,
      };
    });

    for (const w of workloads)
      workloadInfo.set(w.id, {
        clusterId: cluster.id,
        replicas: w.replicas ?? 0,
        cpuRequestM: num(w.cpuRequestM),
        memRequestBytes: num(w.memRequestBytes),
      });

    // ── Stage D: current cost + attribution ──
    const costWorkloads: CostWorkload[] = workloads.map((w) => ({
      workloadId: w.id, namespace: w.namespace, name: w.name,
      replicas: w.replicas ?? 0, cpuRequestM: num(w.cpuRequestM), memRequestBytes: num(w.memRequestBytes),
    }));
    const cost = computeClusterCost(pricedNodes, costWorkloads);

    breakdownRows.push({
      tenantId, clusterId: cluster.id, scope: "cluster",
      namespace: null, workloadId: null, name: cluster.name, monthlyUsd: cost.clusterMonthlyUsd,
    });
    for (const ns of cost.namespaces)
      breakdownRows.push({
        tenantId, clusterId: cluster.id, scope: "namespace",
        namespace: ns.name, workloadId: null, name: ns.name, monthlyUsd: ns.monthlyUsd,
      });
    for (const w of cost.workloads)
      breakdownRows.push({
        tenantId, clusterId: cluster.id, scope: "workload",
        namespace: w.namespace, workloadId: w.workloadId, name: w.name, monthlyUsd: w.monthlyUsd,
      });

    // ── Stage E/F: savings from the proposed spec ──
    const savingsNodes: SavingsNode[] = pricedNodes;
    const savingsWorkloads: SavingsWorkload[] = workloads.map((w) => {
      const prop = proposedByWorkload.get(w.id) ?? {};
      const replicas = w.replicas ?? 0;
      return {
        kind: w.kind, replicas, cpuRequestM: num(w.cpuRequestM), memRequestBytes: num(w.memRequestBytes),
        proposedReplicas: prop.replicas ?? replicas,
        proposedCpuRequestM: prop.cpuRequestM ?? num(w.cpuRequestM),
        proposedMemRequestBytes: prop.memRequestBytes ?? num(w.memRequestBytes),
      };
    });
    const savings = computeClusterSavings(savingsNodes, savingsWorkloads, cluster.autoscaler);

    const pc: PerCluster = {
      perMCpuHrUsd: savings.perMCpuHrUsd,
      perByteHrUsd: savings.perByteHrUsd,
      realizedMonthlyUsd: savings.realizedMonthlyUsd,
      realizability: savings.realizability,
    };
    perClusterById.set(cluster.id, pc);
    perClusterByName.set(cluster.name, pc);
    perClusterList.push({ realizedMonthlyUsd: savings.realizedMonthlyUsd, realizability: savings.realizability });
    wasteAccum += savings.wasteMonthlyUsd;
  }

  // Storage $/GB-month lookup (falls back across region/provider to any gp3-ish row).
  const storageRate = (): number => {
    const exact = storagePrices.find(
      (s) => s.provider === DEFAULT_PROVIDER && s.region === DEFAULT_REGION && s.volumeType === DEFAULT_VOLUME_TYPE,
    );
    const any = exact ?? storagePrices.find((s) => s.volumeType === DEFAULT_VOLUME_TYPE) ?? storagePrices[0];
    return any ? any.pricePerGbMonthUsd.toNumber() : 0;
  };

  // ── Price each recommendation (savings_usd + savings_kind) ──
  // A1: rightsize/replica savings are per-pod × replicas. A2: every priced rec is
  // tagged realized|waste so the two are never summed.
  const recUpdates: { id: string; savingsUsd: number; savingsKind: string }[] = [];
  let storageRealizedUsd = 0;
  for (const r of recs) {
    const w = r.workloadId ? workloadInfo.get(r.workloadId) : undefined;
    const pc = w ? perClusterById.get(w.clusterId) : undefined;
    let usd: number | null = null;
    if (r.type === "cpu-rightsize" && w && pc) {
      usd = rightsizeMonthlyUsd(num(r.currentValue), num(r.proposedValue), w.replicas, pc.perMCpuHrUsd);
    } else if (r.type === "memory-rightsize" && w && pc) {
      usd = rightsizeMonthlyUsd(num(r.currentValue), num(r.proposedValue), w.replicas, pc.perByteHrUsd);
    } else if (r.type === "replica-optimize" && w && pc) {
      usd = replicaMonthlyUsd(
        num(r.currentValue), num(r.proposedValue),
        w.cpuRequestM, w.memRequestBytes, pc.perMCpuHrUsd, pc.perByteHrUsd,
      );
    } else if (r.type === "node-consolidate") {
      usd = perClusterByName.get(r.targetName ?? "")?.realizedMonthlyUsd ?? 0;
    } else if (r.type === "pvc-cleanup") {
      usd = storageMonthlyUsd(num(r.currentValue), storageRate());
      storageRealizedUsd += usd;
    }
    const kind = savingsKindFor(r.type);
    if (usd != null && kind != null) recUpdates.push({ id: r.id, savingsUsd: usd, savingsKind: kind });
  }

  // Plan-level reconciled dollars (realized and waste kept separate, not summed).
  // Realized = nodes freed by the repack + volumes reclaimed; waste = freed requests.
  const realizedMonthlyUsd = round4(
    perClusterList.reduce((s, c) => s + c.realizedMonthlyUsd, 0) + storageRealizedUsd,
  );
  const wasteMonthlyUsd = round4(wasteAccum);

  // ── Persist everything atomically ──
  await prisma.$transaction(async (tx) => {
    await tx.costBreakdown.deleteMany({ where: { tenantId } });
    if (breakdownRows.length > 0)
      await tx.costBreakdown.createMany({ data: breakdownRows.map((b) => ({ ...b, monthlyUsd: b.monthlyUsd })) });

    for (const u of recUpdates)
      await tx.recommendation.update({
        where: { id: u.id },
        data: { savingsUsd: u.savingsUsd, savingsKind: u.savingsKind },
      });

    if (plan) {
      await tx.optimizationPlan.update({
        where: { id: plan.id },
        data: {
          realizedMonthlyUsd,
          wasteMonthlyUsd,
          realizability: rollupRealizability(perClusterList),
          costComputedAt: new Date(),
        },
      });
    }
  });

  return {
    clusters: perClusterById.size,
    breakdownRows: breakdownRows.length,
    realizedMonthlyUsd,
    wasteMonthlyUsd,
    pricedRecs: recUpdates.length,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
