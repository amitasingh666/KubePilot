import { createHash, randomBytes } from "node:crypto";
import { getRootClient } from "@kubepilot/db";

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

// Build the one-line command a customer runs to install the agent in their cluster.
// clusterId + token come from the connection; the ingestion URL comes from config.
export function buildHelmInstallCommand(clusterId: string, token: string): string {
    const ingestionUrl = process.env.INGESTION_URL ?? "http://localhost:3001";

    return `helm install kubepilot-agent kubepilot/agent \\
  --namespace kubepilot --create-namespace \\
  --set clusterId=${clusterId} \\
  --set token=${token} \\
  --set ingestionUrl=${ingestionUrl}`;
}

// Create a cluster connection: register the cluster + issue its agent token.
export async function createClusterConnection(tenantId: string, name: string) {
    const prisma = getRootClient();
  
    // 1. Generate a random token (256 bits). A "kp_" prefix makes it recognizable.
    const token = "kp_" + randomBytes(32).toString("base64url");
  
    // 2. Hash it (we store ONLY the hash).
    const tokenHash = hashToken(token);
  
    // create the Cluster row and AgentCredential
    const cluster = await prisma.$transaction(async (tx) => {
        const c = await tx.cluster.create({
          data: { tenantId, name, status: "pending" },
        });
        await tx.agentCredential.create({
          data: { tenantId, clusterId: c.id, tokenHash },
        });
        return c;
      });

    return {
        clusterId: cluster.id,
        token,
        helmInstall: buildHelmInstallCommand(cluster.id, token),
    };
}


/**
 * Rotate a cluster's agent token: issue a fresh token and give the currently
 * active token(s) a GRACE window instead of revoking them instantly — so the
 * running agent keeps working until the operator redeploys it with the new
 * token. After the grace window the old token expires on its own
 * (verifyAgentToken rejects expired credentials).
 */
export async function rotateClusterToken(clusterId: string) {
  const prisma = getRootClient();
  const graceMs = Number(process.env.TOKEN_ROTATION_GRACE_MS ?? 24 * 60 * 60_000); // 24h default

  const cluster = await prisma.cluster.findUnique({ where: { id: clusterId } });
  if (!cluster) throw new Error(`cluster ${clusterId} not found`);

  // 1. Mint + hash the new token (same scheme as createClusterConnection).
  const token = "kp_" + randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const graceUntil = new Date(Date.now() + graceMs);

  await prisma.$transaction(async (tx) => {
    // 2. Give existing never-expiring active tokens a grace deadline. (Tokens
    //    already in a grace window — expiresAt set — are left as-is.)
    await tx.agentCredential.updateMany({
      where: { clusterId, status: "active", expiresAt: null },
      data: { expiresAt: graceUntil },
    });
    // 3. Issue the new credential (active, no expiry).
    await tx.agentCredential.create({
      data: { tenantId: cluster.tenantId, clusterId, tokenHash },
    });
  });

  return { clusterId, token, graceUntil, helmUpgrade: buildHelmInstallCommand(clusterId, token) };
}

export async function verifyAgentToken(token: string): Promise<
  { tenantId: string; clusterId: string; credentialId: string } | null
> {
  const prisma = getRootClient();

  const tokenHash = hashToken(token);

  const credential = await prisma.agentCredential.findUnique({ where: { tokenHash } });
  if (!credential) return null;

  if(credential.status !== "active" || credential.revokedAt !== null || 
    (credential.expiresAt !== null && credential.expiresAt < new Date())) return null;

  return { tenantId: credential.tenantId, clusterId: credential.clusterId, credentialId: credential.id };
}