import { getRootClient } from "@kubepilot/db";
import type { SessionUser } from "../trpc/context.js";

/** What a login attempt carries. Dev: just an email (+ optional tenant to pick). */
export type LoginInput = { email: string; tenantSlug?: string };

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
 * Dev provider: trusts the email (NO password — local dev only) and resolves it
 * against the seeded app_user + membership rows. If the user belongs to multiple
 * tenants, `tenantSlug` selects one; otherwise the first membership is used.
 */
export class DevAuthProvider implements AuthProvider {
  async authenticate({ email, tenantSlug }: LoginInput): Promise<SessionUser | null> {
    const prisma = getRootClient();
    const user = await prisma.appUser.findUnique({
      where: { email },
      select: {
        id: true,
        memberships: {
          select: { tenantId: true, role: true, tenant: { select: { slug: true } } },
        },
      },
    });
    if (!user || user.memberships.length === 0) return null;

    const m = tenantSlug
      ? user.memberships.find((x) => x.tenant.slug === tenantSlug)
      : user.memberships[0];
    if (!m) return null;

    return { id: user.id, tenantId: m.tenantId, role: m.role };
  }
}

// The active provider. Swap this line for OidcProvider when real SSO lands.
export const authProvider: AuthProvider = new DevAuthProvider();
