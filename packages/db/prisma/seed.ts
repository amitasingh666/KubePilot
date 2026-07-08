import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seed two tenants with users, memberships, and clusters.
 * Runs as the SUPERUSER (DATABASE_URL). Tenant isolation is enforced at the
 * application layer (queries filter by tenantId); there is no DB-level RLS.
 *
 * Dev password for all seeded users: "demo1234".
 */
const prisma = new PrismaClient();
const DEV_PASSWORD_HASH = bcrypt.hashSync("demo1234", 10);

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
      update: { name: t.user.name, passwordHash: DEV_PASSWORD_HASH },
      create: { email: t.user.email, name: t.user.name, passwordHash: DEV_PASSWORD_HASH },
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

  await seedPrices();
}

/**
 * Stage B — list-price seed.
 * Public AWS on-demand list prices (us-east-1, source="list") so the cost engine
 * has real numbers before the real-billing import (Stage H) exists. Spot rows for
 * the m5 family give Stage C a capacity_type to resolve. All upserts key on the
 * catalog's unique tuple, so re-running the seed is idempotent.
 */
const AWS_REGION = "us-east-1";

// [instanceType, $/hr on-demand, vCPU, memory MiB]
const AWS_ON_DEMAND: Array<[string, number, number, number]> = [
  ["t3.medium", 0.0416, 2, 4096],
  ["t3.large", 0.0832, 2, 8192],
  ["m5.large", 0.096, 2, 8192],
  ["m5.xlarge", 0.192, 4, 16384],
  ["m5.2xlarge", 0.384, 8, 32768],
  ["m5.4xlarge", 0.768, 16, 65536],
  ["m6i.large", 0.096, 2, 8192],
  ["m6i.xlarge", 0.192, 4, 16384],
  ["c5.large", 0.085, 2, 4096],
  ["c5.xlarge", 0.17, 4, 8192],
  ["c5.2xlarge", 0.34, 8, 16384],
  ["r5.large", 0.126, 2, 16384],
  ["r5.xlarge", 0.252, 4, 32768],
  ["r5.2xlarge", 0.504, 8, 65536],
];

// Representative spot prices for the m5 family (~31% of on-demand for illustration).
const AWS_SPOT: Array<[string, number]> = [
  ["m5.large", 0.0296],
  ["m5.xlarge", 0.0592],
  ["m5.2xlarge", 0.1184],
  ["m5.4xlarge", 0.2368],
];

// [volumeType, $/GB-month]
const AWS_STORAGE: Array<[string, number]> = [
  ["gp3", 0.08],
  ["gp2", 0.1],
  ["io2", 0.125],
  ["st1", 0.045],
  ["sc1", 0.015],
];

async function seedPrices() {
  const key = (instanceType: string, capacityType: string) => ({
    provider_region_instanceType_capacityType_source: {
      provider: "aws",
      region: AWS_REGION,
      instanceType,
      capacityType,
      source: "list",
    },
  });

  for (const [instanceType, usd, vcpu, memMib] of AWS_ON_DEMAND) {
    await prisma.instancePrice.upsert({
      where: key(instanceType, "on-demand"),
      update: { pricePerHourUsd: usd, vcpu, memMib },
      create: {
        provider: "aws",
        region: AWS_REGION,
        instanceType,
        capacityType: "on-demand",
        source: "list",
        pricePerHourUsd: usd,
        vcpu,
        memMib,
      },
    });
  }

  for (const [instanceType, usd] of AWS_SPOT) {
    const od = AWS_ON_DEMAND.find((r) => r[0] === instanceType);
    await prisma.instancePrice.upsert({
      where: key(instanceType, "spot"),
      update: { pricePerHourUsd: usd },
      create: {
        provider: "aws",
        region: AWS_REGION,
        instanceType,
        capacityType: "spot",
        source: "list",
        pricePerHourUsd: usd,
        vcpu: od?.[2],
        memMib: od?.[3],
      },
    });
  }

  for (const [volumeType, usd] of AWS_STORAGE) {
    await prisma.storagePrice.upsert({
      where: {
        provider_region_volumeType_source: {
          provider: "aws",
          region: AWS_REGION,
          volumeType,
          source: "list",
        },
      },
      update: { pricePerGbMonthUsd: usd },
      create: {
        provider: "aws",
        region: AWS_REGION,
        volumeType,
        source: "list",
        pricePerGbMonthUsd: usd,
      },
    });
  }

  console.log(
    `seeded prices: ${AWS_ON_DEMAND.length} on-demand + ${AWS_SPOT.length} spot instances, ${AWS_STORAGE.length} storage types (aws/${AWS_REGION})`,
  );
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
