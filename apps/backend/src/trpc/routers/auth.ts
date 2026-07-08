/// <reference types="@fastify/cookie" />
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { config } from "../../config.js";
import { authProvider } from "../../auth/provider.js";
import { createSession, destroySession, SESSION_COOKIE } from "../../auth/session.js";
import { recordAudit } from "../../auth/audit.js";
import { hashPassword } from "../../auth/password.js";
import { hashToken } from "../../clusters.js";
import type { SessionUser } from "../context.js";

const WEEK_SECONDS = 60 * 60 * 24 * 7;

// Create a session for a principal and set the httpOnly cookie on the reply.
async function issueSession(res: { setCookie: (n: string, v: string, o: object) => void }, user: SessionUser) {
  const sid = await createSession(user);
  res.setCookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: WEEK_SECONDS,
    secure: config.NODE_ENV === "production",
  });
}

// "Acme Inc!" → "acme-inc"; empty → "org".
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
}

export const authRouter = router({
  /** Dev login: verify the email → create a session → set the httpOnly cookie. */
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1), tenantSlug: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const user = await authProvider.authenticate(input);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "unknown user or tenant" });

      await issueSession(ctx.res, user);
      await recordAudit({ tenantId: user.tenantId, actorId: user.id, actorEmail: input.email, action: "login", ip: ctx.req.ip });
      return { ok: true };
    }),

  /**
   * Register a new COMPANY: creates the tenant + an owner user (with password) +
   * membership, then signs them in. Employees join later via invite (not here).
   */
  register: publicProcedure
    .input(
      z.object({
        companyName: z.string().min(1).max(80),
        name: z.string().min(1).max(80),
        email: z.string().email(),
        password: z.string().min(8, "password must be at least 8 characters"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.appUser.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "that email already has an account — sign in or ask for an invite" });
      }

      // Unique slug from the company name.
      let slug = slugify(input.companyName);
      if (await ctx.db.tenant.findUnique({ where: { slug }, select: { id: true } })) {
        slug = `${slug}-${randomBytes(2).toString("hex")}`;
      }

      const passwordHash = await hashPassword(input.password);
      const { user, tenantId } = await ctx.db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { name: input.companyName, slug } });
        const u = await tx.appUser.create({ data: { email: input.email, name: input.name, passwordHash } });
        await tx.membership.create({ data: { tenantId: tenant.id, userId: u.id, role: "owner" } });
        return { user: u, tenantId: tenant.id };
      });

      const principal: SessionUser = { id: user.id, tenantId, role: "owner" };
      await issueSession(ctx.res, principal);
      await recordAudit({ tenantId, actorId: user.id, actorEmail: input.email, action: "register", metadata: { company: input.companyName }, ip: ctx.req.ip });
      return { ok: true };
    }),

  /** Public: describe an invite token (for the accept page) — 404 if invalid/expired. */
  inviteInfo: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const invite = await ctx.db.invite.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: { email: true, role: true, status: true, expiresAt: true, tenant: { select: { name: true } } },
    });
    if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
      throw new TRPCError({ code: "NOT_FOUND", message: "invite is invalid, used, or expired" });
    }
    return { email: invite.email, role: invite.role, companyName: invite.tenant.name };
  }),

  /** Public: accept an invite by setting a name + password → joins the company. */
  acceptInvite: publicProcedure
    .input(z.object({ token: z.string(), name: z.string().min(1).max(80), password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.invite.findUnique({ where: { tokenHash: hashToken(input.token) } });
      if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "invite is invalid, used, or expired" });
      }
      if (await ctx.db.appUser.findUnique({ where: { email: invite.email }, select: { id: true } })) {
        throw new TRPCError({ code: "CONFLICT", message: "that email already has an account — sign in instead" });
      }

      const passwordHash = await hashPassword(input.password);
      const user = await ctx.db.$transaction(async (tx) => {
        const u = await tx.appUser.create({ data: { email: invite.email, name: input.name, passwordHash } });
        await tx.membership.create({ data: { tenantId: invite.tenantId, userId: u.id, role: invite.role } });
        await tx.invite.update({ where: { id: invite.id }, data: { status: "accepted", acceptedAt: new Date() } });
        return u;
      });

      const principal: SessionUser = { id: user.id, tenantId: invite.tenantId, role: invite.role };
      await issueSession(ctx.res, principal);
      await recordAudit({ tenantId: invite.tenantId, actorId: user.id, actorEmail: invite.email, action: "invite.accept", ip: ctx.req.ip });
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
