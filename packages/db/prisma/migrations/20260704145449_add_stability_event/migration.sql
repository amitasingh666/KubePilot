-- DropIndex
DROP INDEX "usage_metric_node_ts_idx";

-- DropIndex
DROP INDEX "usage_metric_workload_ts_idx";

-- CreateTable
CREATE TABLE "stability_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "workload_id" UUID,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "stability_event_pkey" PRIMARY KEY ("id","ts")
);

-- CreateIndex
CREATE INDEX "stability_event_tenant_id_idx" ON "stability_event"("tenant_id");

-- CreateIndex
CREATE INDEX "stability_event_workload_id_ts_idx" ON "stability_event"("workload_id", "ts");

SELECT create_hypertable('stability_event', 'ts', chunk_time_interval => INTERVAL '7 days');
