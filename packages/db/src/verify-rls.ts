import { PrismaClient } from "@prisma/client";
import { forTenant } from "./client.js";

/**
 * Proves tenant isolation is enforced by Postgres RLS (not just app code).
 * Requires the DB to be migrated and seeded (tenants: acme, globex).
 *
 *  - superuser client (DATABASE_URL): used only to look up seed ids / assert setup.
 *  - app-role client (APP_DATABASE_URL): the RLS-enforced runtime path.
 */
const superUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!superUrl || !appUrl) {
  throw new Error("Both DATABASE_URL and APP_DATABASE_URL must be set.");
}

const superuser = new PrismaClient({ datasources: { db: { url: superUrl } } });
const appBase = new PrismaClient({ datasources: { db: { url: appUrl } } });

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✅ PASS  ${msg}`);
  } else {
    console.error(`  ❌ FAIL  ${msg}`);
    failures++;
  }
}

async function main() {
  console.log("RLS verification\n----------------");

  const acme = await superuser.tenant.findUnique({ where: { slug: "acme" } });
  const globex = await superuser.tenant.findUnique({ where: { slug: "globex" } });
  check(!!acme && !!globex, "seed tenants exist (acme, globex)");
  if (!acme || !globex) return;

  const acmeDb = forTenant(acme.id, appBase);
  const globexDb = forTenant(globex.id, appBase);

  const acmeClusters = await acmeDb.cluster.findMany();
  const globexClusters = await globexDb.cluster.findMany();

  check(
    acmeClusters.length > 0 && acmeClusters.every((c) => c.tenantId === acme.id),
    `tenant "acme" sees only its own clusters (${acmeClusters.length})`,
  );
  check(
    globexClusters.length > 0 && globexClusters.every((c) => c.tenantId === globex.id),
    `tenant "globex" sees only its own clusters (${globexClusters.length})`,
  );

  // Cross-tenant read attempt: acme tries to fetch a globex cluster by id.
  const target = globexClusters[0];
  if (target) {
    const leaked = await acmeDb.cluster.findUnique({ where: { id: target.id } });
    check(leaked === null, "tenant \"acme\" CANNOT read a \"globex\" cluster by id (no leak)");
  }

  // No tenant context set → deny-all.
  const noContext = await appBase.cluster.findMany();
  check(noContext.length === 0, "app client with no tenant context sees zero rows");

  // Tenant sees itself, not the other, on the tenant table.
  const acmeSelf = await acmeDb.tenant.findMany();
  check(
    acmeSelf.length === 1 && acmeSelf[0]?.id === acme.id,
    "tenant table is self-scoped (acme sees exactly itself)",
  );
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await superuser.$disconnect();
    await appBase.$disconnect();
    console.log("----------------");
    if (failures > 0) {
      console.error(`RLS verification FAILED (${failures} failing check(s)).`);
      process.exit(1);
    } else {
      console.log("RLS verification PASSED — tenant isolation enforced by Postgres.");
      process.exit(0);
    }
  });
