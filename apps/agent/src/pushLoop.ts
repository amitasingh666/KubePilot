// Task: the scheduled push loop + local retry buffer.

import type { KubeConfig } from "@kubernetes/client-node";
import type { Snapshot } from "@kubepilot/contract";
import { collectInventorySnapshot } from "./collect.js";
import { collectUsageSnapshot } from "./usage.js";
import { pushSnapshot, PushError } from "./push.js";
import { sanitizeSnapshot } from "./sanitize.js";
const COLLECT_INTERVAL_MS = Number(process.env.PUSH_INTERVAL_MS ?? 5 * 60_000);
const TICK_MS = Number(process.env.PUSH_TICK_MS ?? 30_000);
const MAX_ATTEMPTS = Number(process.env.PUSH_MAX_ATTEMPTS ?? 8);

type Pending = { snapshot: Snapshot; attempts: number; nextAttemptAt: number };

// Exponential backoff with a ceiling: 1s, 2s, 4s, 8s … capped at 5 min.
function backoffMs(attempts: number): number {
    return Math.min(1000 * 2 ** attempts, 5 * 60_000);
}

const buffer: Pending[] = [];

function remove(item: Pending): void {
    const i = buffer.indexOf(item);
    if (i !== -1) buffer.splice(i, 1);
}

/** Collect a fresh inventory + usage snapshot pair. */
async function collect(
    kc: KubeConfig,
    clusterId: string,
    agentVersion: string,
): Promise<Snapshot[]> {
    const [inventory, usage] = await Promise.all([
        collectInventorySnapshot(kc, clusterId, agentVersion),
        collectUsageSnapshot(kc, clusterId, agentVersion),
    ]);
    return [inventory, usage].map(sanitizeSnapshot);
}

/** Try to deliver every buffered snapshot whose time has come. */
async function flush(token: string, now: number): Promise<void> {
    const due = buffer.filter((p) => p.nextAttemptAt <= now);
    for (const item of due) {
        try {
            await pushSnapshot(item.snapshot, token);
            remove(item);
            continue;

        } catch (err) {
            if (err instanceof PushError && !err.retryable) {
                console.error("dropping snapshot, permanent failure:", err.message);
                remove(item);
            } else {
                item.attempts++;
                if (item.attempts >= MAX_ATTEMPTS) {
                    console.error("giving up after retries");
                    remove(item);
                } else {
                    item.nextAttemptAt = now + backoffMs(item.attempts);
                }
            }
        }
    }
}

/** Start the scheduled push loop. Runs until the process exits. */
export function startPushLoop(
    kc: KubeConfig,
    clusterId: string,
    agentVersion: string,
    token: string,
): void {
    let lastCollectAt = 0;

    const tick = async () => {
        const now = Date.now();

        if (now - lastCollectAt >= COLLECT_INTERVAL_MS){
            try{
                const fresh = await collect(kc, clusterId, agentVersion);
                for(const s of fresh){
                    buffer.push({snapshot:s, attempts:0, nextAttemptAt: now})
                }
                lastCollectAt = now;
            }catch(err){
                console.error("collect failed:", err)
            }
        }

        await flush(token, now);
    };

    void tick(); // run once immediately
    setInterval(() => void tick(), TICK_MS);
}