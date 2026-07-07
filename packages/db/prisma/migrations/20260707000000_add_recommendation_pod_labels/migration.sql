-- Phase 2: recommendation table + workload.pod_labels
-- (already applied via `prisma db push`; this file records it as a migration.)

-- workload: pod-template labels (what PDBs/Services select on)
ALTER TABLE "workload" ADD COLUMN "pod_labels" JSONB;

-- recommendation: engine output (rightsizing / replica / cleanup)
CREATE TABLE "recommendation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workload_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "current_value" BIGINT NOT NULL,
    "proposed_value" BIGINT NOT NULL,
    "savings" BIGINT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rationale" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    CONSTRAINT "recommendation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recommendation_tenant_id_idx" ON "recommendation"("tenant_id");
CREATE INDEX "recommendation_workload_id_idx" ON "recommendation"("workload_id");
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_workload_id_fkey"
    FOREIGN KEY ("workload_id") REFERENCES "workload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
