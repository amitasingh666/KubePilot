import { getRootClient } from "@kubepilot/db";
import type { SessionUser } from "../trpc/context.js";
import { verifyPassword } from "./password.js";

/** What a login attempt carries. */
export type LoginInput = { email: string; password: string; tenantSlug?: string };

/**
 * Auth is behind this interface so the mechanism can be swapped without touching
 * the API. Stage 4 ships a DevAuthProvider (local, no IdP); a real OidcProvider
 * (WorkOS/Auth0) implements the same interface later — the routers, sessions, and
 * RBAC above it don't change.
 */
export interface AuthProvider {
  /** Verify a login and resolve the principal (which user, tenant, and role). */
  authenticate(input: LoginInput): Promise<SessionUser | null>;
}

/**
 * Password provider: verifies email + password against the bcrypt hash on the
 * user, then resolves their membership. If the user belongs to multiple tenants,
 * `tenantSlug` selects one; otherwise the first membership is used. Swap for an
 * OidcProvider behind this same interface when real SSO lands.
 */
export class PasswordAuthProvider implements AuthProvider {
  async authenticate({ email, password, tenantSlug }: LoginInput): Promise<SessionUser | null> {
    const prisma = getRootClient();
    const user = await prisma.appUser.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        memberships: {
          select: { tenantId: true, role: true, tenant: { select: { slug: true } } },
        },
      },
    });
    if (!user || !user.passwordHash || user.memberships.length === 0) return null;
    if (!(await verifyPassword(password, user.passwordHash))) return null;

    const m = tenantSlug
      ? user.memberships.find((x) => x.tenant.slug === tenantSlug)
      : user.memberships[0];
    if (!m) return null;

    return { id: user.id, tenantId: m.tenantId, role: m.role };
  }
}

export const authProvider: AuthProvider = new PasswordAuthProvider();
