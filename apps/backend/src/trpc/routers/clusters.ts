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

  /** Full detail for one cluster: header + nodes + workloads + autoscalers. */
  detail: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const cluster = await ctx.db.cluster.findFirst({
      where: { id: input.id },
      select: {
        id: true, name: true, provider: true, region: true, distribution: true,
        autoscaler: true, gitops: true, status: true, lastSeenAt: true, agentVersion: true, createdAt: true,
      },
    });
    if (!cluster) throw new TRPCError({ code: "NOT_FOUND", message: "cluster not found" });

    // All tenant-scoped (the client injects tenantId); clusterId narrows to this cluster.
    const [nodes, workloads, autoscalers] = await Promise.all([
      ctx.db.node.findMany({
        where: { clusterId: input.id },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, instanceType: true, capacityProvider: true, status: true,
          cpuAllocatableM: true, memAllocatableBytes: true,
        },
      }),
      ctx.db.workload.findMany({
        where: { clusterId: input.id },
        orderBy: [{ namespace: "asc" }, { name: "asc" }],
        select: {
          id: true, namespace: true, name: true, kind: true, replicas: true,
          cpuRequestM: true, memRequestBytes: true, managedBy: true,
        },
      }),
      ctx.db.autoscaler.findMany({
        where: { clusterId: input.id },
        select: { id: true, kind: true, minReplicas: true, maxReplicas: true, metric: true, workloadId: true },
      }),
    ]);

    // BigInt (mem bytes) → number for clean serialization.
    return {
      cluster,
      nodes: nodes.map((n) => ({ ...n, memAllocatableBytes: n.memAllocatableBytes == null ? null : Number(n.memAllocatableBytes) })),
      workloads: workloads.map((w) => ({ ...w, memRequestBytes: w.memRequestBytes == null ? null : Number(w.memRequestBytes) })),
      autoscalers,
    };
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
