import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@kubepilot/db";
import { router, protectedProcedure, roleProcedure } from "../trpc.js";
import { WRITE_ROLES } from "../../auth/rbac.js";
import { createClusterConnection, rotateClusterToken } from "../../clusters.js";

export const clustersRouter = router({
  /** All of the tenant's clusters, with health + scale, newest first. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.cluster.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, provider: true, region: true, status: true,
        lastSeenAt: true, agentVersion: true, createdAt: true,
        _count: { select: { nodes: true, workloads: true } },
      },
    }),
  ),

  /** One cluster (tenant-scoped — 404 if it isn't ours). */
  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const cluster = await ctx.db.cluster.findFirst({
      where: { id: input.id },
      select: {
        id: true, name: true, provider: true, region: true, distribution: true,
        autoscaler: true, status: true, lastSeenAt: true, agentVersion: true, createdAt: true,
        _count: { select: { nodes: true, workloads: true } },
      },
    });
    if (!cluster) throw new TRPCError({ code: "NOT_FOUND", message: "cluster not found" });
    return cluster;
  }),

  /**
   * Register a new cluster + issue its agent token. Owners/admins only.
   * Returns the token ONCE (only the hash is stored) plus the Helm command.
   */
  createConnection: roleProcedure(...WRITE_ROLES)
    .input(z.object({ name: z.string().min(1).max(63) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createClusterConnection(ctx.user.tenantId, input.name);
      } catch (err) {
        // (tenantId, name) is unique — surface a clean conflict instead of a 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new TRPCError({ code: "CONFLICT", message: `a cluster named "${input.name}" already exists` });
        }
        throw err;
      }
    }),

  /** Rotate a cluster's agent token (grace window). Owners/admins only. */
  rotateToken: roleProcedure(...WRITE_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Ownership check via the scoped client BEFORE calling the (unscoped) helper,
      // so one tenant can't rotate another tenant's token by guessing an id.
      const owned = await ctx.db.cluster.findFirst({ where: { id: input.id }, select: { id: true } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "cluster not found" });
      return rotateClusterToken(input.id);
    }),
});
