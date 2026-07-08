import { getRootClient } from "@kubepilot/db";

/** One security-sensitive action to record. */
export type AuditEntry = {
  tenantId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string; // e.g. "login", "cluster.create", "cluster.rotateToken"
  targetKind?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Append an audit entry. Uses the root client (audit must record regardless of
 * tenant scoping) and never throws into the caller — a logging failure must not
 * break the action being audited.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await getRootClient().auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        targetKind: entry.targetKind ?? null,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? undefined) as object | undefined,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error("audit log write failed", entry.action, err);
  }
}
