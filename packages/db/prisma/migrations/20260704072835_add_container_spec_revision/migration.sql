-- CreateTable
CREATE TABLE "container_spec" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workload_id" UUID NOT NULL,
    "container" TEXT NOT NULL,
    "cpu_request_m" INTEGER,
    "cpu_limit_m" INTEGER,
    "mem_request_bytes" BIGINT,
    "mem_limit_bytes" BIGINT,

    CONSTRAINT "container_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload_revision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workload_id" UUID NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replicas" INTEGER,
    "cpu_request_m" INTEGER,
    "cpu_limit_m" INTEGER,
    "mem_request_bytes" BIGINT,
    "mem_limit_bytes" BIGINT,
    "spec_hash" TEXT,

    CONSTRAINT "workload_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "container_spec_tenant_id_idx" ON "container_spec"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "container_spec_workload_id_container_key" ON "container_spec"("workload_id", "container");

-- CreateIndex
CREATE INDEX "workload_revision_workload_id_observed_at_idx" ON "workload_revision"("workload_id", "observed_at");

-- CreateIndex
CREATE INDEX "workload_revision_tenant_id_idx" ON "workload_revision"("tenant_id");

-- AddForeignKey
ALTER TABLE "container_spec" ADD CONSTRAINT "container_spec_workload_id_fkey" FOREIGN KEY ("workload_id") REFERENCES "workload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_revision" ADD CONSTRAINT "workload_revision_workload_id_fkey" FOREIGN KEY ("workload_id") REFERENCES "workload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
