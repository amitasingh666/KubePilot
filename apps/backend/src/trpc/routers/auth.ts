/// <reference types="@fastify/cookie" />
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { config } from "../../config.js";
import { authProvider } from "../../auth/provider.js";
import { createSession, destroySession, SESSION_COOKIE } from "../../auth/session.js";
import { recordAudit } from "../../auth/audit.js";

const WEEK_SECONDS = 60 * 60 * 24 * 7;

export const authRouter = router({
  /** Dev login: verify the email → create a session → set the httpOnly cookie. */
  login: publicProcedure
    .input(z.object({ email: z.string().email(), tenantSlug: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const user = await authProvider.authenticate(input);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "unknown user or tenant" });

      const sid = await createSession(user);
      ctx.res.setCookie(SESSION_COOKIE, sid, {
        httpOnly: true, // JS in the browser can't read it → mitigates XSS token theft
        sameSite: "lax",
        path: "/",
        maxAge: WEEK_SECONDS,
        secure: config.NODE_ENV === "production",
      });
      await recordAudit({ tenantId: user.tenantId, actorId: user.id, actorEmail: input.email, action: "login", ip: ctx.req.ip });
      return { ok: true };
    }),

  /** Lightweight "am I logged in?" — null when anonymous. Never throws. */
  me: publicProcedure.query(({ ctx }) => ctx.user),

  /** Full profile — requires auth; reads via the tenant-scoped client. */
  profile: protectedProcedure.query(async ({ ctx }) => {
    const [user, tenant] = await Promise.all([
      ctx.db.appUser.findUnique({ where: { id: ctx.user.id }, select: { email: true, name: true } }),
      ctx.db.tenant.findUnique({ where: { id: ctx.user.tenantId }, select: { name: true, slug: true } }),
    ]);
    return {
      id: ctx.user.id,
      email: user?.email ?? null,
      name: user?.name ?? null,
      role: ctx.user.role,
      tenantId: ctx.user.tenantId,
      tenantName: tenant?.name ?? null,
      tenantSlug: tenant?.slug ?? null,
    };
  }),

  /** Logout: revoke the session server-side and clear the cookie. */
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const sid = ctx.req.cookies?.[SESSION_COOKIE];
    if (sid) {
      await destroySession(sid);
      ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
    }
    if (ctx.user) await recordAudit({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, action: "logout", ip: ctx.req.ip });
    return { ok: true };
  }),
});
