/**
 * RBAC role definitions. The enforcement lives in trpc.ts (roleProcedure checks
 * ctx.user.role against an allowed set); this module names the meaningful sets so
 * routers read intention-first, e.g. roleProcedure(...WRITE_ROLES).
 */
export const ALL_ROLES = ["owner", "admin", "viewer", "finops"] as const;
export type Role = (typeof ALL_ROLES)[number];

// Who may mutate infrastructure (create cluster connections, rotate tokens).
export const WRITE_ROLES: Role[] = ["owner", "admin"];

// Who may see cost/finance views (everyone in v1, but named for future tightening).
export const COST_ROLES: Role[] = ["owner", "admin", "viewer", "finops"];
