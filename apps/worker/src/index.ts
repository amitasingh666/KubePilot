import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Snapshot } from "@kubepilot/contract";
import { getRootClient, Prisma } from "@kubepilot/db";
import { writeInventory } from "./writeInventory.js";
import { writeUsage, writeEvents } from "./writeUsage.js";

const redisUrl = process.env.REDIS_QUEUE_URL;
if (!redisUrl) throw new Error("REDIS_QUEUE_URL is not set");

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// The exact shape the backend enqueues (Stage C). Typing job.data with this
// gives you autocomplete + safety when you read snapshot fields in D3.
type IngestionJob = {
  snapshot: Snapshot;
  tenantId: string;
  clusterId: string;
  credentialId: string;
};

const worker = new Worker<IngestionJob>(
  "ingestion",
  async (job) => {
    const { tenantId, snapshot } = job.data;
    const prisma = getRootClient();

    try {
      // Claim + write in ONE transaction: if any write fails, the claim rolls
      // back too, so a retry reprocesses cleanly. The unique
      // (clusterId, idempotencyKey) constraint makes the claim the dedup guard.
      await prisma.$transaction(async (tx) => {
        await tx.ingestionSnapshot.create({
          data: {
            tenantId,
            clusterId: snapshot.clusterId,
            idempotencyKey: snapshot.idempotencyKey,
            agentVersion: snapshot.agentVersion,
            payloadKind: snapshot.payloadKind,
          },
        });
        await writeInventory(tx, tenantId, snapshot);
        await writeUsage(tx, tenantId, snapshot);
        await writeEvents(tx, tenantId, snapshot);
      });
      console.log(`▶️  processed ${snapshot.payloadKind} for cluster ${snapshot.clusterId}`);
    } catch (err) {
      // P2002 = unique constraint violation = already seen this snapshot.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        console.log(`⏭️  duplicate snapshot ${snapshot.idempotencyKey}, skipping`);
        return; // don't reprocess
      }
      throw err; // real error → let BullMQ retry the job
    }
  },
  { connection },
);

worker.on("completed", (job) => console.log("✅ completed", job.id));
worker.on("failed", (job, err) => console.error("❌ failed", job?.id, err));

console.log("worker started, waiting for jobs…");

const shutdown = async () => {
  await worker.close();
  connection.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);