-- CreateTable
CREATE TABLE "scheduling_constraint" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workload_id" UUID NOT NULL,
    "node_selector" JSONB,
    "affinity" JSONB,
    "anti_affinity" JSONB,
    "tolerations" JSONB,
    "topology_spread" JSONB,
    "pvc_affinity" JSONB,

    CONSTRAINT "scheduling_constraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "payload_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "ingestion_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autoscaler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "workload_id" UUID,
    "kind" TEXT NOT NULL,
    "min_replicas" INTEGER,
    "max_replicas" INTEGER,
    "metric" TEXT,
    "target_json" JSONB,
    "update_mode" TEXT,
    "spec_json" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autoscaler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_disruption_budget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_available" TEXT,
    "max_unavailable" TEXT,
    "selector_json" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_disruption_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvc" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_class" TEXT,
    "capacity_bytes" BIGINT,
    "volume_type" TEXT,
    "bound" BOOLEAN,
    "mounted" BOOLEAN,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "k8s_service" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "has_traffic" BOOLEAN,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "k8s_service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduling_constraint_workload_id_key" ON "scheduling_constraint"("workload_id");

-- CreateIndex
CREATE INDEX "scheduling_constraint_tenant_id_idx" ON "scheduling_constraint"("tenant_id");

-- CreateIndex
CREATE INDEX "ingestion_snapshot_tenant_id_idx" ON "ingestion_snapshot"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_snapshot_cluster_id_idempotency_key_key" ON "ingestion_snapshot"("cluster_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "autoscaler_cluster_id_idx" ON "autoscaler"("cluster_id");

-- CreateIndex
CREATE INDEX "autoscaler_tenant_id_idx" ON "autoscaler"("tenant_id");

-- CreateIndex
CREATE INDEX "pod_disruption_budget_tenant_id_idx" ON "pod_disruption_budget"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_disruption_budget_cluster_id_namespace_name_key" ON "pod_disruption_budget"("cluster_id", "namespace", "name");

-- CreateIndex
CREATE INDEX "pvc_tenant_id_idx" ON "pvc"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pvc_cluster_id_namespace_name_key" ON "pvc"("cluster_id", "namespace", "name");

-- CreateIndex
CREATE INDEX "k8s_service_tenant_id_idx" ON "k8s_service"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "k8s_service_cluster_id_namespace_name_key" ON "k8s_service"("cluster_id", "namespace", "name");

-- AddForeignKey
ALTER TABLE "scheduling_constraint" ADD CONSTRAINT "scheduling_constraint_workload_id_fkey" FOREIGN KEY ("workload_id") REFERENCES "workload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_snapshot" ADD CONSTRAINT "ingestion_snapshot_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autoscaler" ADD CONSTRAINT "autoscaler_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_disruption_budget" ADD CONSTRAINT "pod_disruption_budget_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvc" ADD CONSTRAINT "pvc_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "k8s_service" ADD CONSTRAINT "k8s_service_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
