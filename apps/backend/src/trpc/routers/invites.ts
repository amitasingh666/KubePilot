import { randomBytes } from "node:crypto";
import { z } from "zod";
import { router, roleProcedure } from "../trpc.js";
import { config } from "../../config.js";
import { WRITE_ROLES } from "../../auth/rbac.js";
import { hashToken } from "../../clusters.js";
import { recordAudit } from "../../auth/audit.js";
import { emailSender, renderInviteEmail } from "../../email.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

export const invitesRouter = router({
  /** Current members of the company. Owners/admins only. */
  members: roleProcedure(...WRITE_ROLES).query(({ ctx }) =>
    ctx.db.membership
      .findMany({ select: { role: true, createdAt: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: "asc" } })
      .then((rows) => rows.map((m) => ({ email: m.user.email, name: m.user.name, role: m.role, joinedAt: m.createdAt }))),
  ),

  /** Pending invites for the company. */
  list: roleProcedure(...WRITE_ROLES).query(({ ctx }) =>
    ctx.db.invite.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ),

  /** Create an invite → returns a shareable accept link (also the only place the token appears). */
  create: roleProcedure(...WRITE_ROLES)
    .input(z.object({ email: z.string().email(), role: z.enum(["owner", "admin", "viewer", "finops"]) }))
    .mutation(async ({ ctx, input }) => {
      const token = "kp_inv_" + randomBytes(24).toString("base64url");
      await ctx.db.invite.create({
        data: {
          tenantId: ctx.user.tenantId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedById: ctx.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await recordAudit({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, action: "invite.create", metadata: { email: input.email, role: input.role }, ip: ctx.req.ip });

      const inviteUrl = `${config.WEB_ORIGIN}/accept-invite?token=${token}`;

      // Email the invite to the new member. Look up the company name + inviter for the message.
      // Never let a mail failure fail invite creation — the owner can still copy the link.
      try {
        const [tenant, inviter] = await Promise.all([
          ctx.db.tenant.findUnique({ where: { id: ctx.user.tenantId }, select: { name: true } }),
          ctx.db.appUser.findUnique({ where: { id: ctx.user.id }, select: { email: true } }),
        ]);
        const email = renderInviteEmail({
          companyName: tenant?.name ?? "your team",
          role: input.role,
          inviteUrl,
          invitedByEmail: inviter?.email,
        });
        await emailSender.send({ ...email, to: input.email });
      } catch (err) {
        console.error(`[invites.create] failed to send invite email to ${input.email}:`, err);
      }

      return { inviteUrl };
    }),

  /** Revoke a pending invite. */
  revoke: roleProcedure(...WRITE_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.invite.updateMany({ where: { id: input.id, status: "pending" }, data: { status: "revoked" } });
      return { ok: true };
    }),
});
