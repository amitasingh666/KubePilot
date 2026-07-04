-- CreateEnum
CREATE TYPE "WorkloadKind" AS ENUM ('deployment', 'statefulset', 'daemonset', 'cronjob', 'job', 'replicaset', 'rollout');

-- CreateTable
CREATE TABLE "node" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "node_group" TEXT,
    "instance_type" TEXT,
    "capacity_provider" TEXT,
    "cpu_capacity_m" INTEGER,
    "mem_capacity_bytes" BIGINT,
    "cpu_allocatable_m" INTEGER,
    "mem_allocatable_bytes" BIGINT,
    "taints" JSONB,
    "labels" JSONB,
    "status" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkloadKind" NOT NULL,
    "replicas" INTEGER,
    "cpu_request_m" INTEGER,
    "mem_request_bytes" BIGINT,
    "cpu_limit_m" INTEGER,
    "mem_limit_bytes" BIGINT,
    "qos_class" TEXT,
    "priority_class" TEXT,
    "managed_by" TEXT NOT NULL DEFAULT 'none',
    "gitops_owned" BOOLEAN NOT NULL DEFAULT false,
    "gitops_source" JSONB,
    "labels" JSONB,
    "spec_hash" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "workload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "node_tenant_id_idx" ON "node"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "node_cluster_id_name_key" ON "node"("cluster_id", "name");

-- CreateIndex
CREATE INDEX "workload_cluster_id_namespace_idx" ON "workload"("cluster_id", "namespace");

-- CreateIndex
CREATE INDEX "workload_managed_by_idx" ON "workload"("managed_by");

-- CreateIndex
CREATE UNIQUE INDEX "workload_cluster_id_namespace_name_kind_key" ON "workload"("cluster_id", "namespace", "name", "kind");

-- AddForeignKey
ALTER TABLE "node" ADD CONSTRAINT "node_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload" ADD CONSTRAINT "workload_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
