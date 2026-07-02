-- Phase 0 base data model: tenant, app_user, membership, cluster.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'viewer', 'finops');
CREATE TYPE "ClusterStatus" AS ENUM ('pending', 'connected', 'stale', 'disconnected', 'archived');

-- CreateTable: tenant
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data_region" TEXT NOT NULL DEFAULT 'us',
    "billing_plan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateTable: app_user (global identity; no tenant_id)
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "idp_subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateTable: membership (user <-> tenant + role)
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "membership_tenant_id_user_id_key" ON "membership"("tenant_id", "user_id");
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: cluster
CREATE TABLE "cluster" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "region" TEXT,
    "distribution" TEXT,
    "autoscaler" TEXT,
    "prometheus_flavor" TEXT,
    "gitops" TEXT,
    "status" "ClusterStatus" NOT NULL DEFAULT 'pending',
    "last_seen_at" TIMESTAMP(3),
    "agent_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    CONSTRAINT "cluster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cluster_tenant_id_name_key" ON "cluster"("tenant_id", "name");
CREATE INDEX "cluster_tenant_id_status_idx" ON "cluster"("tenant_id", "status");
ALTER TABLE "cluster" ADD CONSTRAINT "cluster_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
