import Fastify from "fastify";
import { Redis } from "ioredis";
import { getRootClient } from "@kubepilot/db";
import { AGENT_CONTRACT_VERSION } from "@kubepilot/contract";
import { config } from "./config.js";

const app = Fastify({ logger: true });

const prisma = getRootClient();
const redisQueue = new Redis(config.REDIS_QUEUE_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const redisCache = new Redis(config.REDIS_CACHE_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

// Liveness — process is up.
app.get("/health", async () => ({
  status: "ok",
  service: "backend",
  contractVersion: AGENT_CONTRACT_VERSION,
  ts: new Date().toISOString(),
}));

// Readiness — dependencies reachable.
app.get("/ready", async (_req, reply) => {
  const checks = { db: false, redisQueue: false, redisCache: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (err) {
    app.log.error({ err }, "db readiness check failed");
  }

  const pingRedis = async (r: Redis) => {
    if (r.status === "wait" || r.status === "close" || r.status === "end") {
      await r.connect();
    }
    return (await r.ping()) === "PONG";
  };

  try {
    checks.redisQueue = await pingRedis(redisQueue);
  } catch (err) {
    app.log.error({ err }, "redis-queue readiness check failed");
  }
  try {
    checks.redisCache = await pingRedis(redisCache);
  } catch (err) {
    app.log.error({ err }, "redis-cache readiness check failed");
  }

  const ok = Object.values(checks).every(Boolean);
  reply.code(ok ? 200 : 503);
  return { status: ok ? "ready" : "degraded", checks };
});

async function start() {
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  redisQueue.disconnect();
  redisCache.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void start();
