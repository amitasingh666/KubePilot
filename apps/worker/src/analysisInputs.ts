import type { PrismaClient } from "@kubepilot/db";

// History each signal needs before we trust it (else "preliminary").
// Research: CPU is a fast signal (~7d); memory/periodicity wants 14–30d.
const CPU_MIN_DAYS = Number(process.env.CPU_MIN_DAYS ?? 7);
const MEM_MIN_DAYS = Number(process.env.MEM_MIN_DAYS ?? 14);
const WINDOW_DAYS = Number(process.env.ANALYSIS_WINDOW_DAYS ?? 30);

export type Sufficiency = "sufficient" | "preliminary";

/** Everything a rule needs to reason about one workload. */
export type AnalysisInput = {
  workloadId: string;
  namespace: string;
  name: string;
  kind: string;
  managedBy: string;
  replicas: number | null;
  // Highest integer PDB minAvailable that selects this workload's pods (null = none). Floor for replica cuts.
  pdbMinReplicas: number | null;
  // current spec (what's reserved)
  cpuRequestM: number | null;
  memRequestBytes: number | null;
  cpuLimitM: number | null;
  memLimitBytes: number | null;
  // observed usage over the window
  cpuP95M: number | null;
  memMaxBytes: number | null;
  restarts: number;
  daysOfHistory: number;
  cpuSufficiency: Sufficiency;
  memSufficiency: Sufficiency;
};

// One rolled-up usage row per workload over the window.
type UsageRow = { cpuP95M: number; memMaxBytes: number; restarts: number; days: number };

/**
 * Read the daily continuous aggregate (usage_workload_daily) — the efficient,
 * intended read path — and roll it up to ONE row per workload over the window:
 *   cpuP95M     = peak daily CPU p95 (max across days — conservative)
 *   memMaxBytes = peak working set   (max across days — OOM-safe)
 *   days        = distinct days with data (drives data-sufficiency)
 * Raw SQL because a continuous aggregate isn't a Prisma model.
 */
async function loadUsageByWorkload(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Map<string, UsageRow>> {
  const rows = await prisma.$queryRaw<
    {
      workload_id: string;
      cpu_p95_m: number | null;
      mem_max_bytes: bigint | null;
      restarts: bigint | null;
      days: bigint;
    }[]
  >`
    SELECT workload_id,
           max(cpu_p95_max_m) AS cpu_p95_m,
           max(mem_max_bytes) AS mem_max_bytes,
           sum(restarts)      AS restarts,
           count(*)           AS days
    FROM usage_workload_daily
    WHERE tenant_id = ${tenantId}::uuid
      AND day >= now() - make_interval(days => ${WINDOW_DAYS}::int)
    GROUP BY workload_id
  `;

  const map = new Map<string, UsageRow>();
  for (const r of rows) {
    map.set(r.workload_id, {
      cpuP95M: r.cpu_p95_m ?? 0,
      memMaxBytes: Number(r.mem_max_bytes ?? 0n), // bigint → number
      restarts: Number(r.restarts ?? 0n),
      days: Number(r.days),
    });
  }
  return map;
}

// Does a PDB selector's matchLabels match a workload's pod labels? (matchExpressions
// aren't evaluated in v1 — a PDB using only expressions won't be matched.)
function selectorMatches(selector: unknown, podLabels: Record<string, string>): boolean {
  const ml = (selector as { matchLabels?: Record<string, string> } | null)?.matchLabels;
  if (!ml || Object.keys(ml).length === 0) return false; // empty/absent → don't over-apply
  return Object.entries(ml).every(([k, v]) => podLabels[k] === v);
}

// Parse an integer PDB minAvailable ("2" → 2). Percentages ("50%") need replica
// context we skip in v1, so they return null.
function pdbMinInt(minAvailable: string | null): number | null {
  if (!minAvailable || minAvailable.endsWith("%")) return null;
  const n = Number(minAvailable);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Build per-workload analysis inputs for a tenant, with sufficiency verdicts. */
export async function buildAnalysisInputs(
  prisma: PrismaClient,
  tenantId: string,
): Promise<AnalysisInput[]> {
  const workloads = await prisma.workload.findMany({
    where: { tenantId },
    select: {
      id: true,
      clusterId: true,
      namespace: true,
      name: true,
      kind: true,
      managedBy: true,
      replicas: true,
      podLabels: true,
      cpuRequestM: true,
      memRequestBytes: true,
      cpuLimitM: true,
      memLimitBytes: true,
    },
  });

  const usage = await loadUsageByWorkload(prisma, tenantId);
  const pdbs = await prisma.podDisruptionBudget.findMany({
    where: { tenantId },
    select: { clusterId: true, namespace: true, minAvailable: true, selector: true },
  });

  return workloads.map((w) => {
    const u = usage.get(w.id);
    const days = u?.days ?? 0;
    const podLabels = (w.podLabels ?? {}) as Record<string, string>;
    // Most-restrictive integer PDB minAvailable among PDBs (same cluster+ns) selecting these pods.
    let pdbMinReplicas: number | null = null;
    for (const pdb of pdbs) {
      if (pdb.clusterId !== w.clusterId || pdb.namespace !== w.namespace) continue;
      if (!selectorMatches(pdb.selector, podLabels)) continue;
      const m = pdbMinInt(pdb.minAvailable);
      if (m != null) pdbMinReplicas = pdbMinReplicas == null ? m : Math.max(pdbMinReplicas, m);
    }
    return {
      workloadId: w.id,
      namespace: w.namespace,
      name: w.name,
      kind: w.kind,
      managedBy: w.managedBy,
      replicas: w.replicas,
      pdbMinReplicas,
      cpuRequestM: w.cpuRequestM,
      memRequestBytes: w.memRequestBytes == null ? null : Number(w.memRequestBytes),
      cpuLimitM: w.cpuLimitM,
      memLimitBytes: w.memLimitBytes == null ? null : Number(w.memLimitBytes),
      cpuP95M: u?.cpuP95M ?? null,
      memMaxBytes: u?.memMaxBytes ?? null,
      restarts: u?.restarts ?? 0,
      daysOfHistory: days,
      cpuSufficiency: days >= CPU_MIN_DAYS ? "sufficient" : "preliminary",
      memSufficiency: days >= MEM_MIN_DAYS ? "sufficient" : "preliminary",
    };
  });
}
