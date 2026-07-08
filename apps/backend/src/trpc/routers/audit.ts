import { z } from "zod";
import { router, roleProcedure } from "../trpc.js";
import { WRITE_ROLES } from "../../auth/rbac.js";

export const auditRouter = router({
  /** Recent audit entries for the tenant. Owners/admins only (it's security data). */
  list: roleProcedure(...WRITE_ROLES)
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ ctx, input }) =>
      ctx.db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        select: { id: true, actorEmail: true, action: true, targetKind: true, targetId: true, ip: true, createdAt: true },
      }),
    ),
});
