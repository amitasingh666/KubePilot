-- CreateTable
CREATE TABLE "usage_metric_workload" (
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "workload_id" UUID NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "window_sec" INTEGER NOT NULL,
    "cpu_p95_m" INTEGER,
    "cpu_avg_m" INTEGER,
    "mem_max_bytes" BIGINT,
    "mem_avg_bytes" BIGINT,
    "restarts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_metric_workload_pkey" PRIMARY KEY ("workload_id","ts","window_sec")
);

-- CreateTable
CREATE TABLE "usage_metric_node" (
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "window_sec" INTEGER NOT NULL,
    "cpu_used_m" INTEGER,
    "mem_used_bytes" BIGINT,
    "cpu_alloc_pct" DOUBLE PRECISION,
    "mem_alloc_pct" DOUBLE PRECISION,

    CONSTRAINT "usage_metric_node_pkey" PRIMARY KEY ("node_id","ts","window_sec")
);

-- CreateIndex
CREATE INDEX "usage_metric_workload_tenant_id_idx" ON "usage_metric_workload"("tenant_id");

-- CreateIndex
CREATE INDEX "usage_metric_node_tenant_id_idx" ON "usage_metric_node"("tenant_id");

SELECT create_hypertable('usage_metric_workload', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('usage_metric_node',     'ts', chunk_time_interval => INTERVAL '1 day');
