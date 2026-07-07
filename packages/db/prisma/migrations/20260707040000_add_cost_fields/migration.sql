-- AlterTable
ALTER TABLE "optimization_plan" ADD COLUMN     "cost_computed_at" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "realizability" TEXT,
ADD COLUMN     "realized_monthly_usd" DECIMAL(14,4),
ADD COLUMN     "waste_monthly_usd" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "recommendation" ADD COLUMN     "savings_usd" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "cost_breakdown" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "namespace" TEXT,
    "workload_id" UUID,
    "name" TEXT NOT NULL,
    "monthly_usd" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_breakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_breakdown_tenant_id_cluster_id_idx" ON "cost_breakdown"("tenant_id", "cluster_id");

-- CreateIndex
CREATE INDEX "cost_breakdown_tenant_id_scope_idx" ON "cost_breakdown"("tenant_id", "scope");

