import { PrismaClient } from "@prisma/client";

/**
 * RLS-aware Prisma access.
 *
 * Prisma has no native Row-Level Security support: it uses pooled connections
 * and does not set a per-request session variable. So we wrap every query in a
 * transaction that first runs `SET LOCAL app.tenant_id = <uuid>` (via
 * `set_config(..., is_local => true)`), which the RLS policies read through
 * `app_current_tenant()`.
 *
 * Runtime services connect as the non-superuser `kubepilot_app` role
 * (APP_DATABASE_URL) so RLS is actually enforced.
 */

let _root: PrismaClient | null = null;

/** Base client bound to the app role (RLS enforced). Uses APP_DATABASE_URL. */
export function getRootClient(): PrismaClient {
  if (!_root) {
    const url = process.env.APP_DATABASE_URL;
    if (!url) {
      throw new Error(
        "APP_DATABASE_URL is not set — runtime services must connect as the app role.",
      );
    }
    _root = new PrismaClient({ datasources: { db: { url } } });
  }
  return _root;
}

/**
 * Returns a tenant-scoped client. Every model operation runs inside a
 * transaction that sets `app.tenant_id` first, so Postgres RLS transparently
 * filters all reads/writes to this tenant.
 *
 * Usage:
 *   const db = forTenant(tenantId);
 *   const clusters = await db.cluster.findMany(); // only this tenant's rows
 */
export function forTenant(tenantId: string, base: PrismaClient = getRootClient()) {
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          query(args),
        ]);
        return result;
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof forTenant>;
