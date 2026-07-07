import { router, protectedProcedure } from "../trpc.js";

// Prisma Decimal → plain number so it serializes cleanly to the client.
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export const costRouter = router({
  /**
   * Tenant cost summary for the overview page. Reads what the worker persisted:
   * cost_breakdown rows (current cost) + the latest optimization_plan ($ savings).
   * Realized and waste are returned SEPARATELY — never summed (Phase 3 rule).
   */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [breakdown, plan] = await Promise.all([
      ctx.db.costBreakdown.findMany({ select: { scope: true, name: true, monthlyUsd: true } }),
      ctx.db.optimizationPlan.findFirst({
        orderBy: { createdAt: "desc" },
        select: { realizedMonthlyUsd: true, wasteMonthlyUsd: true, realizability: true, costComputedAt: true },
      }),
    ]);

    const byCluster = breakdown
      .filter((b) => b.scope === "cluster")
      .map((b) => ({ name: b.name, monthlyUsd: n(b.monthlyUsd) }))
      .sort((a, b) => b.monthlyUsd - a.monthlyUsd);

    const topNamespaces = breakdown
      .filter((b) => b.scope === "namespace")
      .map((b) => ({ name: b.name, monthlyUsd: n(b.monthlyUsd) }))
      .sort((a, b) => b.monthlyUsd - a.monthlyUsd)
      .slice(0, 8);

    return {
      totalMonthlyUsd: byCluster.reduce((s, c) => s + c.monthlyUsd, 0),
      realizedMonthlyUsd: n(plan?.realizedMonthlyUsd),
      wasteMonthlyUsd: n(plan?.wasteMonthlyUsd),
      realizability: plan?.realizability ?? "n/a",
      costComputedAt: plan?.costComputedAt ?? null,
      byCluster,
      topNamespaces,
    };
  }),

  /** Full cost breakdown (all scopes) for the Reports page. Read-only. */
  breakdown: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.costBreakdown.findMany({
      select: { scope: true, name: true, namespace: true, monthlyUsd: true },
      orderBy: { monthlyUsd: "desc" },
    });
    return rows.map((r) => ({ ...r, monthlyUsd: n(r.monthlyUsd) }));
  }),
});
