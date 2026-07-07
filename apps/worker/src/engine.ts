
import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { getRootClient } from "@kubepilot/db";
import { buildAnalysisInputs, type AnalysisInput } from "./analysisInputs.js";
import { cpuRightsizing } from "./rules/cpuRightsizing.js";
import { memoryRightsizing } from "./rules/memoryRightsizing.js";
import { replicaOptimization } from "./rules/replicaOptimization.js";
import { unusedCleanup } from "./rules/unusedCleanup.js";
import { nodeConsolidationRecs } from "./rules/nodeConsolidation.js";
import { orphanedPvcRecs } from "./rules/orphanedPvc.js";
import { persistRecommendations, type AnyRecommendation } from "./persistRecommendations.js";

// The rule registry: each takes one workload's inputs and returns a rec or null.
// Add a new rule → add it here; nothing else in the engine changes.
const RULES: Array<(w: AnalysisInput) => AnyRecommendation | null> = [
  cpuRightsizing,
  memoryRightsizing,
  replicaOptimization,
  unusedCleanup,
];

const redisUrl = process.env.REDIS_QUEUE_URL;
if (!redisUrl) throw new Error("REDIS_QUEUE_URL is not set");

// Queue can share a connection; the Worker needs its own (blocking ops).
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// How often analysis runs. Daily by default; override short for local dev.
const ANALYSIS_INTERVAL_MS = Number(process.env.ANALYSIS_INTERVAL_MS ?? 24 * 60 * 60_000);

const analysisQueue = new Queue("analysis", { connection });
const prisma = getRootClient();

const engineWorker = new Worker(
    "analysis",
    async (job) => {
        // "fanout" tick → shard into one job PER tenant (fairness).
        if (job.name === "fanout") {
            const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
            for (const t of tenants) {
                await analysisQueue.add("analyze-tenant", { tenantId: t.id });
            }
            console.log(`fanned out analysis for ${tenants.length} tenants`);

            return;
        }
        // One tenant's analysis — Task 1 stub (load data + log). Rules come next.
        if (job.name === "analyze-tenant") {
            const { tenantId } = job.data as { tenantId: string };
            const inputs = await buildAnalysisInputs(prisma, tenantId);
            // Per-workload rules + per-cluster bin-packing (node consolidation).
            const workloadRecs = RULES.flatMap((rule) => inputs.map(rule)).filter(
                (r): r is AnyRecommendation => r !== null,
            );
            const nodeRecs = await nodeConsolidationRecs(prisma, tenantId);
            const pvcRecs = await orphanedPvcRecs(prisma, tenantId);
            const recs: AnyRecommendation[] = [...workloadRecs, ...nodeRecs, ...pvcRecs];
            // GitOps-owned lookup for patch generation (kubectl vs PR-to-source).
            const gitopsByWorkload = new Map(inputs.map((i) => [i.workloadId, i.gitopsOwned]));
            const n = await persistRecommendations(prisma, tenantId, recs, gitopsByWorkload);
            const byType = recs.reduce<Record<string, number>>((acc, r) => {
                acc[r.type] = (acc[r.type] ?? 0) + 1;
                return acc;
            }, {});
            console.log(
                `tenant ${tenantId}: ${inputs.length} workloads → persisted ${n} recommendations`,
                byType,
            );
            return;
        }
    },
    { connection: workerConnection },
);

engineWorker.on("failed", (job, err) => console.error("❌ analysis job failed", job?.id, err));

// Register the repeatable fan-out tick (idempotent across restarts).
await analysisQueue.add("fanout", {}, { repeat: { every: ANALYSIS_INTERVAL_MS } });
console.log("⚙️  engine started — analysis scheduler running");

const shutdown = async () => {
    await Promise.all([engineWorker.close(), analysisQueue.close()]);
    connection.disconnect();
    workerConnection.disconnect();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);