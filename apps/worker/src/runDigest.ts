// Phase 5 — digest runner. Builds a tenant's cost digest, stores the HTML in S3,
// and sends it via the pluggable EmailSender to the tenant's owner.
import type { PrismaClient } from "@kubepilot/db";
import { renderDigestHtml, renderDigestText, type DigestData, type DigestRec } from "./digest.js";
import { putObject, presignedGetUrl } from "./storage.js";
import { emailSender, type EmailSender } from "./email.js";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export async function runDigest(
  prisma: PrismaClient,
  tenantId: string,
  sender: EmailSender = emailSender,
): Promise<{ key: string; url: string; to: string } | null> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
  if (!tenant) return null;

  // Recipient = an owner of the tenant (skip if none).
  const owner = await prisma.membership.findFirst({
    where: { tenantId, role: "owner" },
    select: { user: { select: { email: true } } },
  });
  const to = owner?.user.email;
  if (!to) return null;

  const [breakdown, plan, recs, outcomes] = await Promise.all([
    prisma.costBreakdown.findMany({ where: { tenantId, scope: "cluster" }, select: { monthlyUsd: true } }),
    prisma.optimizationPlan.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, select: { realizedMonthlyUsd: true, wasteMonthlyUsd: true } }),
    prisma.recommendation.findMany({
      where: { tenantId, status: "open" },
      orderBy: { savingsUsd: "desc" },
      take: 5,
      select: { type: true, targetName: true, targetNamespace: true, savingsUsd: true, savingsKind: true },
    }),
    prisma.optimizationOutcome.findMany({ where: { tenantId }, select: { safe: true } }),
  ]);

  const safe = outcomes.filter((o) => o.safe).length;
  const topRecs: DigestRec[] = recs.map((r) => ({
    label: `${r.type} · ${r.targetNamespace ? r.targetNamespace + "/" : ""}${r.targetName ?? ""}`,
    savingsUsd: r.savingsUsd == null ? null : Number(r.savingsUsd),
    kind: r.savingsKind,
  }));

  const data: DigestData = {
    tenantName: tenant.name,
    date: new Date().toISOString().slice(0, 10),
    totalMonthlyUsd: breakdown.reduce((s, b) => s + num(b.monthlyUsd), 0),
    realizedMonthlyUsd: num(plan?.realizedMonthlyUsd ?? null),
    wasteMonthlyUsd: num(plan?.wasteMonthlyUsd ?? null),
    accuracyPct: outcomes.length > 0 ? Math.round((safe / outcomes.length) * 100) : null,
    topRecs,
  };

  const key = `digests/${tenant.slug}/${data.date}.html`;
  await putObject(key, renderDigestHtml(data));
  const url = await presignedGetUrl(key);
  await sender.send({
    to,
    subject: `KubePilot cost digest — ${data.date}`,
    html: renderDigestHtml(data),
    text: `${renderDigestText(data)}\n\nFull report: ${url}`,
  });

  return { key, url, to };
}
