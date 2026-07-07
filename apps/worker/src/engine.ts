
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
import { computeAndPersistCost } from "./cost/computeCost.js";
import { runFeedback } from "./runFeedback.js";
import { runDigest } from "./runDigest.js";

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
// How often the email digest is sent (daily by default).
const DIGEST_INTERVAL_MS = Number(process.env.DIGEST_INTERVAL_MS ?? 24 * 60 * 60_000);

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
            // Phase 3 — attach dollars: current cost, node-level savings, rollups.
            const cost = await computeAndPersistCost(prisma, tenantId);
            console.log(
                `tenant ${tenantId}: cost → realized $${cost.realizedMonthlyUsd}/mo, waste $${cost.wasteMonthlyUsd}/mo, ` +
                `${cost.breakdownRows} breakdown rows, ${cost.pricedRecs} recs priced`,
            );
            // Phase 5 — feedback loop: infer applied optimizations from revision history.
            const detected = await runFeedback(prisma, tenantId);
            console.log(`tenant ${tenantId}: feedback → ${detected} applied optimization(s) detected`);
            return;
        }
        // Phase 5 — digest fanout tick → one digest job per tenant.
        if (job.name === "digest-fanout") {
            const tenants = await prisma.tenant.findMany({ select: { id: true } });
            for (const t of tenants) await analysisQueue.add("digest-tenant", { tenantId: t.id });
            console.log(`fanned out digests for ${tenants.length} tenants`);
            return;
        }
        // One tenant's digest — build, store in S3, send via the email sender.
        if (job.name === "digest-tenant") {
            const { tenantId } = job.data as { tenantId: string };
            const sent = await runDigest(prisma, tenantId);
            console.log(sent ? `tenant ${tenantId}: digest sent → ${sent.to} (${sent.key})` : `tenant ${tenantId}: digest skipped (no owner)`);
            return;
        }
    },
    { connection: workerConnection },
);

engineWorker.on("failed", (job, err) => console.error("❌ analysis job failed", job?.id, err));

// Register the repeatable fan-out ticks (idempotent across restarts).
await analysisQueue.add("fanout", {}, { repeat: { every: ANALYSIS_INTERVAL_MS } });
await analysisQueue.add("digest-fanout", {}, { repeat: { every: DIGEST_INTERVAL_MS } });
console.log("⚙️  engine started — analysis + digest schedulers running");

const shutdown = async () => {
    await Promise.all([engineWorker.close(), analysisQueue.close()]);
    connection.disconnect();
    workerConnection.disconnect();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);