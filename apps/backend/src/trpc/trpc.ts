import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { forTenant } from "@kubepilot/db";
import type { Context } from "./context.js";

// superjson so Date / BigInt / Decimal survive the wire (cost values are BigInt/Decimal).
const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Open to anyone (health, dev login). */
export const publicProcedure = t.procedure;

/**
 * Requires a logged-in user. Narrows ctx.user to non-null AND replaces ctx.db
 * with a tenant-scoped client, so downstream resolvers physically cannot read
 * another tenant's rows. (ctx.user stays null until Stage C wires sessions, so
 * this rejects everything for now — intentional.)
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "login required" });
  return next({ ctx: { ...ctx, user: ctx.user, db: forTenant(ctx.user.tenantId) } });
});

/** Requires the user to hold one of the given RBAC roles (owner/admin/viewer/finops). */
export const roleProcedure = (...roles: string[]) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `requires role: ${roles.join(" | ")}` });
    }
    return next();
  });
