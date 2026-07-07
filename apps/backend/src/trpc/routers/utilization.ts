import { router, protectedProcedure } from "../trpc.js";

const WINDOW_DAYS = 30;

type UtilRow = { req_cpu: bigint | null; used_cpu: bigint | null; req_mem: bigint | null; used_mem: bigint | null };

export const utilizationRouter = router({
  /**
   * Tenant-wide requested-vs-used for CPU and memory — the core "you pay for X,
   * use Y" waste story. "Used" = peak per-pod signal (CPU p95 / mem MAX from the
   * usage aggregate) × replicas; an estimate, comparable to requested. Raw SQL
   * (the aggregate isn't a Prisma model) with an explicit tenant filter.
   */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.$queryRaw<UtilRow[]>`
      SELECT
        SUM(COALESCE(w.replicas, 0) * COALESCE(w.cpu_request_m, 0))     AS req_cpu,
        SUM(COALESCE(w.replicas, 0) * COALESCE(u.cpu_p95_m, 0))         AS used_cpu,
        SUM(COALESCE(w.replicas, 0) * COALESCE(w.mem_request_bytes, 0)) AS req_mem,
        SUM(COALESCE(w.replicas, 0) * COALESCE(u.mem_max_bytes, 0))     AS used_mem
      FROM workload w
      LEFT JOIN (
        SELECT workload_id, max(cpu_p95_max_m) AS cpu_p95_m, max(mem_max_bytes) AS mem_max_bytes
        FROM usage_workload_daily
        WHERE tenant_id = ${ctx.user.tenantId}::uuid
          AND day >= now() - make_interval(days => ${WINDOW_DAYS}::int)
        GROUP BY workload_id
      ) u ON u.workload_id = w.id
      WHERE w.tenant_id = ${ctx.user.tenantId}::uuid
    `;

    const r: Partial<UtilRow> = rows[0] ?? {};
    const cpu = { requestedM: Number(r.req_cpu ?? 0), usedM: Number(r.used_cpu ?? 0) };
    const memory = { requestedBytes: Number(r.req_mem ?? 0), usedBytes: Number(r.used_mem ?? 0) };
    const pct = (used: number, req: number) => (req > 0 ? Math.round((used / req) * 100) : 0);

    return {
      cpu: { ...cpu, utilPct: pct(cpu.usedM, cpu.requestedM) },
      memory: { ...memory, utilPct: pct(memory.usedBytes, memory.requestedBytes) },
    };
  }),
});
