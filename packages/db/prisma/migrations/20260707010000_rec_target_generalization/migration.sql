-- Generalize recommendation target: a rec can point at a workload OR a node/pvc/cluster.
ALTER TABLE "recommendation" ALTER COLUMN "workload_id" DROP NOT NULL;
ALTER TABLE "recommendation" ADD COLUMN "target_kind" TEXT NOT NULL DEFAULT 'workload';
ALTER TABLE "recommendation" ADD COLUMN "target_name" TEXT;
ALTER TABLE "recommendation" ADD COLUMN "target_namespace" TEXT;
-- FK becomes nullable-compatible (unchanged constraint; workload_id now nullable)
