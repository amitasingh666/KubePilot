import { getRootClient } from "@kubepilot/db";
import { createClusterConnection } from "./clusters.js";

async function main() {
  const prisma = getRootClient();

  // 1. Find a tenant to attach the cluster to (acme was created by the seed).
  const acme = await prisma.tenant.findUnique({ where: { slug: "acme" } });
  if (!acme) throw new Error('No "acme" tenant — run `pnpm db:seed` first.');

  // 2. Call the function under test. Date.now() keeps the name unique per run
  //    (cluster has a @@unique([tenantId, name]), so a fixed name would clash on re-run).
  const result = await createClusterConnection(acme.id, `manual-test-${Date.now()}`);

  // 3. Print what it returned.
  console.log("clusterId:", result.clusterId);
  console.log("token (shown once):", result.token);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});