// Phase 6 — hardening regression tests. Integration tests against the dev DB
// (needs APP_DATABASE_URL — the `test` script loads ../../.env). They assert the
// security invariants that must never regress: tenant isolation, agent-token
// lifecycle, and ingestion idempotency. Each test cleans up after itself.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRootClient, forTenant, Prisma } from "@kubepilot/db";
import {
  createClusterConnection,
  rotateClusterToken,
  verifyAgentToken,
  hashToken,
} from "./clusters.js";

const prisma = getRootClient();
const suffix = Date.now();
let t1 = "";
let t2 = "";

beforeAll(async () => {
  const a = await prisma.tenant.create({ data: { name: "Harden T1", slug: `harden-t1-${suffix}` } });
  const b = await prisma.tenant.create({ data: { name: "Harden T2", slug: `harden-t2-${suffix}` } });
  t1 = a.id;
  t2 = b.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [t1, t2] } } }); // cascades clusters/credentials/snapshots
  await prisma.$disconnect();
});

describe("multi-tenant isolation (forTenant)", () => {
  it("scopes reads so one tenant never sees another's rows", async () => {
    const c = await forTenant(t1).cluster.create({ data: { tenantId: t1, name: "iso-a", status: "pending" } });

    const t1View = await forTenant(t1).cluster.findMany({ where: { name: "iso-a" } });
    const t2View = await forTenant(t2).cluster.findMany({ where: { name: "iso-a" } });
    expect(t1View).toHaveLength(1);
    expect(t2View).toHaveLength(0);

    // Even with the exact id, the other tenant can't read it.
    expect(await forTenant(t2).cluster.findFirst({ where: { id: c.id } })).toBeNull();
    expect(await forTenant(t1).cluster.findFirst({ where: { id: c.id } })).not.toBeNull();
  });

  it("stamps tenant_id on writes automatically", async () => {
    // tenantId omitted on purpose — the scoped client injects it at runtime.
    // (TS can't express that through the extension, hence the suppression.)
    // @ts-expect-error intentional omission
    const c = await forTenant(t1).cluster.create({ data: { name: "iso-stamp", status: "pending" } });
    expect(c.tenantId).toBe(t1);
  });

  it("forbids unsafe single-row ops on scoped models", async () => {
    await expect(forTenant(t1).cluster.findUnique({ where: { id: t1 } })).rejects.toThrow(/not tenant-safe/);
  });
});

describe("agent token lifecycle", () => {
  it("issues a token that verifies to its cluster+tenant", async () => {
    const { clusterId, token } = await createClusterConnection(t1, "tok-a");
    const id = await verifyAgentToken(token);
    expect(id).toMatchObject({ tenantId: t1, clusterId });
  });

  it("rotates: new token works, old token gets a grace expiry", async () => {
    const { clusterId, token: oldToken } = await createClusterConnection(t1, "tok-rotate");
    const { token: newToken } = await rotateClusterToken(clusterId);

    expect(await verifyAgentToken(newToken)).not.toBeNull(); // new works
    expect(await verifyAgentToken(oldToken)).not.toBeNull(); // old still valid during grace

    const oldCred = await prisma.agentCredential.findUnique({ where: { tokenHash: hashToken(oldToken) } });
    expect(oldCred?.expiresAt).not.toBeNull(); // …but now has a deadline
  });

  it("rejects a revoked or expired token", async () => {
    const { token } = await createClusterConnection(t1, "tok-revoke");
    await prisma.agentCredential.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
    expect(await verifyAgentToken(token)).toBeNull();

    const { token: t } = await createClusterConnection(t1, "tok-expire");
    await prisma.agentCredential.updateMany({ where: { tokenHash: hashToken(t) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyAgentToken(t)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await verifyAgentToken("kp_not-a-real-token")).toBeNull();
  });
});

describe("ingestion idempotency", () => {
  it("dedupes a replayed snapshot by (clusterId, idempotencyKey)", async () => {
    const { clusterId } = await createClusterConnection(t1, "idem");
    const snap = { tenantId: t1, clusterId, idempotencyKey: `k-${suffix}`, agentVersion: "1.0", payloadKind: "inventory" };

    await prisma.ingestionSnapshot.create({ data: snap });

    // Replaying the same key must violate the unique constraint (P2002).
    let code: string | undefined;
    try {
      await prisma.ingestionSnapshot.create({ data: snap });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) code = err.code;
    }
    expect(code).toBe("P2002");
  });
});
