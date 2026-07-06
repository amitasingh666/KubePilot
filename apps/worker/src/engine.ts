
import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { getRootClient } from "@kubepilot/db";
import { buildAnalysisInputs } from "./analysisInputs.js";
import { cpuRightsizing, type Recommendation } from "./rules/cpuRightsizing.js";
import { memoryRightsizing, type MemRecommendation } from "./rules/memoryRightsizing.js";

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
            const cpuRecs = inputs
                .map(cpuRightsizing)
                .filter((r): r is Recommendation => r !== null);
            const memRecs = inputs
                .map(memoryRightsizing)
                .filter((r): r is MemRecommendation => r !== null);
            console.log(
                `tenant ${tenantId}: ${inputs.length} workloads → ` +
                    `${cpuRecs.length} CPU + ${memRecs.length} memory rightsizing recs`,
            );
            for (const r of [...cpuRecs, ...memRecs]) {
                console.log(`  • ${r.namespace}/${r.name}: ${r.rationale}`);
            }
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