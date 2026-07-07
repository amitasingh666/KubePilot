-- CreateTable
CREATE TABLE "optimization_outcome" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID,
    "workload_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "from_value" BIGINT NOT NULL,
    "to_value" BIGINT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "safe" BOOLEAN NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optimization_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "optimization_outcome_tenant_id_idx" ON "optimization_outcome"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "optimization_outcome_workload_id_resource_detected_at_key" ON "optimization_outcome"("workload_id", "resource", "detected_at");

