import { PrismaClient } from "@prisma/client";

/**
 * Seed two tenants with users, memberships, and clusters.
 * Runs as the SUPERUSER (DATABASE_URL) so it bypasses RLS while inserting
 * cross-tenant data. The RLS guarantees are then checked by verify-rls.ts,
 * which connects as the app role.
 */
const prisma = new PrismaClient();

async function main() {
  const tenants = [
    {
      slug: "acme",
      name: "Acme Corp",
      user: { email: "owner@acme.test", name: "Acme Owner" },
      clusters: ["acme-prod", "acme-staging"],
    },
    {
      slug: "globex",
      name: "Globex Inc",
      user: { email: "owner@globex.test", name: "Globex Owner" },
      clusters: ["globex-prod"],
    },
  ];

  for (const t of tenants) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: { name: t.name },
      create: { name: t.name, slug: t.slug },
    });

    const user = await prisma.appUser.upsert({
      where: { email: t.user.email },
      update: { name: t.user.name },
      create: { email: t.user.email, name: t.user.name },
    });

    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      update: { role: "owner" },
      create: { tenantId: tenant.id, userId: user.id, role: "owner" },
    });

    for (const name of t.clusters) {
      await prisma.cluster.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name } },
        update: {},
        create: { tenantId: tenant.id, name, status: "pending" },
      });
    }

    console.log(`seeded tenant "${t.slug}" with ${t.clusters.length} cluster(s)`);
  }
}

main()
  .then(() => console.log("seed complete"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
