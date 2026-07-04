-- CreateTable
CREATE TABLE "agent_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cluster_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mtls_fingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "agent_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_credential_cluster_id_idx" ON "agent_credential"("cluster_id");

-- CreateIndex
CREATE INDEX "agent_credential_tenant_id_idx" ON "agent_credential"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_credential_token_hash_key" ON "agent_credential"("token_hash");

-- AddForeignKey
ALTER TABLE "agent_credential" ADD CONSTRAINT "agent_credential_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
