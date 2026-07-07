import { router, protectedProcedure } from "../trpc.js";

const num = (v: bigint | number | null): number | null => (v == null ? null : Number(v));

export const recommendationsRouter = router({
  /**
   * All open recommendations for the tenant, ranked by monthly $ (biggest
   * opportunity first). BigInt resource values → numbers; Decimal $ → number.
   * savingsKind (realized|waste) travels with each row so the UI never conflates them.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.recommendation.findMany({
      where: { status: "open" },
      select: {
        id: true, type: true, targetKind: true, targetName: true, targetNamespace: true,
        resource: true, unit: true, currentValue: true, proposedValue: true,
        savingsUsd: true, savingsKind: true, confidence: true, rationale: true,
        patch: true, patchMode: true,
      },
    });

    return rows
      .map((r) => ({
        ...r,
        currentValue: num(r.currentValue),
        proposedValue: num(r.proposedValue),
        savingsUsd: r.savingsUsd == null ? null : Number(r.savingsUsd),
      }))
      // Highest $ first (unpriced last); tiebreak high-confidence first.
      .sort((a, b) => {
        const d = (b.savingsUsd ?? -1) - (a.savingsUsd ?? -1);
        if (d !== 0) return d;
        return (a.confidence === "high" ? 0 : 1) - (b.confidence === "high" ? 0 : 1);
      });
  }),
});
