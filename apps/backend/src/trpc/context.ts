import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { getRootClient } from "@kubepilot/db";
import { getSession, SESSION_COOKIE } from "../auth/session.js";

/** The authenticated principal — resolved from the session cookie per request. */
export type SessionUser = { id: string; tenantId: string; role: string };

/**
 * Per-request tRPC context. Every resolver receives this.
 * - `req`/`res`     — the Fastify request/reply (auth reads cookies from here in Stage C)
 * - `user`          — the logged-in user, or null (Stage C fills this from the session)
 * - `db`            — the ROOT client for now; once auth resolves a tenant (Stage C),
 *                     protectedProcedure swaps in forTenant(user.tenantId) so resolvers
 *                     get a client that can only see their tenant's data.
 */
export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // Resolve the session cookie → principal. Missing/expired → anonymous (null).
  const sid = req.cookies?.[SESSION_COOKIE];
  const user = sid ? await getSession(sid) : null;

  return {
    req,
    res,
    user,
    db: getRootClient(),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
