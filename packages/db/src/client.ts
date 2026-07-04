import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client. Connects as the limited app role via APP_DATABASE_URL
 * (least privilege — it cannot alter/drop schema; migrations use the superuser).
 *
 * Tenant isolation is enforced at the APPLICATION LAYER: every query must filter
 * by `tenantId` (and set it on writes). RLS is deferred as production hardening —
 * see docs/07-Database-Schema.md §14.
 */

let _client: PrismaClient | null = null;

export function getRootClient(): PrismaClient {
  if (!_client) {
    const url = process.env.APP_DATABASE_URL;
    if (!url) {
      throw new Error(
        "APP_DATABASE_URL is not set — runtime services must connect as the app role.",
      );
    }
    _client = new PrismaClient({ datasources: { db: { url } } });
  }
  return _client;
}
