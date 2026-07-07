import { router, protectedProcedure } from "../trpc.js";

const n = (v: bigint | number): number => Number(v);

export const feedbackRouter = router({
  /**
   * Recommendation-accuracy summary (Phase 5). "Accuracy" = of the optimizations
   * we detected as applied, the share that stayed safe (no post-change regression)
   * — the measurable proxy for the ≥90% KPI.
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const outcomes = await ctx.db.optimizationOutcome.findMany({
      orderBy: { detectedAt: "desc" },
      select: { resource: true, fromValue: true, toValue: true, detectedAt: true, safe: true, note: true },
    });

    const detected = outcomes.length;
    const safe = outcomes.filter((o) => o.safe).length;

    return {
      detected,
      safe,
      accuracyPct: detected > 0 ? Math.round((safe / detected) * 100) : null,
      recent: outcomes.slice(0, 10).map((o) => ({
        resource: o.resource,
        fromValue: n(o.fromValue),
        toValue: n(o.toValue),
        detectedAt: o.detectedAt,
        safe: o.safe,
        note: o.note,
      })),
    };
  }),
});
