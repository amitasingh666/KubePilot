import { getRootClient } from "./client.js";

/**
 * Tenant-scoped Prisma client (Phase 4 — application-layer isolation).
 *
 * `forTenant(tenantId)` returns a client where every query against a tenant-owned
 * model is automatically constrained to that tenant — the where-clause is injected
 * for reads, and tenant_id is stamped onto writes — so no dashboard query can
 * forget it. Models WITHOUT a tenant_id (Tenant, AppUser, InstancePrice,
 * StoragePrice) pass through untouched.
 *
 * RLS is still deferred (see client.ts); this is the app-layer enforcement.
 */

// Models that carry a tenant_id column — the only ones we scope. Keep in sync
// with schema.prisma (every model with `tenantId`).
const TENANT_SCOPED = new Set<string>([
  "Cluster", "Node", "Workload", "ContainerSpec", "WorkloadRevision",
  "SchedulingConstraint", "IngestionSnapshot", "Autoscaler", "PodDisruptionBudget",
  "Pvc", "K8sService", "AgentCredential", "UsageMetricWorkload", "UsageMetricNode",
  "StabilityEvent", "Recommendation", "OptimizationPlan", "PriceOverride",
  "CostBreakdown", "Membership",
]);

// Operations that accept an arbitrary `where` → inject tenantId as a filter.
const WHERE_OPS = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "updateMany", "deleteMany",
]);

// Single-row-by-unique-key operations. A non-unique tenantId can't be added to a
// unique locator, so these can't be transparently scoped — we forbid them on
// scoped models and steer callers to the safe *Many / findFirst equivalents.
const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

export function forTenant(tenantId: string) {
  return getRootClient().$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED.has(model)) return query(args);

          if (UNIQUE_OPS.has(operation)) {
            throw new Error(
              `forTenant: ${operation} on ${model} is not tenant-safe — ` +
                `use findFirst/updateMany/deleteMany (auto-scoped by tenantId) instead.`,
            );
          }

          const a = (args ?? {}) as Record<string, unknown>;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where as object | undefined), tenantId };
          } else if (operation === "create") {
            a.data = { ...(a.data as object | undefined), tenantId };
          } else if (operation === "createMany") {
            const data = a.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
            const rows = Array.isArray(data) ? data : data ? [data] : [];
            a.data = rows.map((r) => ({ ...r, tenantId }));
          }
          return query(a);
        },
      },
    },
  });
}

/** A tenant-scoped client instance (what forTenant returns). */
export type ScopedClient = ReturnType<typeof forTenant>;
