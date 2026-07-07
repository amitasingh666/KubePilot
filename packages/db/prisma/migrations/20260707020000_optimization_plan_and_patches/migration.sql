-- optimization_plan: reconciled plan per tenant per run
CREATE TABLE "optimization_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rec_count" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "optimization_plan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "optimization_plan_tenant_id_idx" ON "optimization_plan"("tenant_id");

-- recommendation: applyable patch + link to a plan
ALTER TABLE "recommendation" ADD COLUMN "patch" TEXT;
ALTER TABLE "recommendation" ADD COLUMN "patch_mode" TEXT;
ALTER TABLE "recommendation" ADD COLUMN "plan_id" UUID;
CREATE INDEX "recommendation_plan_id_idx" ON "recommendation"("plan_id");
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "optimization_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
