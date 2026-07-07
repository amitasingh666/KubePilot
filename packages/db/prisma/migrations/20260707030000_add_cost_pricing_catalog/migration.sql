-- CreateTable
CREATE TABLE "instance_price" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "instance_type" TEXT NOT NULL,
    "capacity_type" TEXT NOT NULL DEFAULT 'on-demand',
    "source" TEXT NOT NULL DEFAULT 'list',
    "price_per_hour_usd" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "vcpu" INTEGER,
    "mem_mib" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_price" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "volume_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'list',
    "price_per_gb_month_usd" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_override" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'instance_type',
    "provider" TEXT,
    "region" TEXT,
    "instance_type" TEXT,
    "node_group" TEXT,
    "cluster_id" UUID,
    "commitment_type" TEXT NOT NULL DEFAULT 'on-demand',
    "price_per_hour_usd" DECIMAL(12,6),
    "discount_pct" DECIMAL(5,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instance_price_provider_region_idx" ON "instance_price"("provider", "region");

-- CreateIndex
CREATE UNIQUE INDEX "instance_price_provider_region_instance_type_capacity_type__key" ON "instance_price"("provider", "region", "instance_type", "capacity_type", "source");

-- CreateIndex
CREATE INDEX "storage_price_provider_region_idx" ON "storage_price"("provider", "region");

-- CreateIndex
CREATE UNIQUE INDEX "storage_price_provider_region_volume_type_source_key" ON "storage_price"("provider", "region", "volume_type", "source");

-- CreateIndex
CREATE INDEX "price_override_tenant_id_idx" ON "price_override"("tenant_id");

-- AddForeignKey
ALTER TABLE "price_override" ADD CONSTRAINT "price_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

