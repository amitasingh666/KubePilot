// apps/agent/src/push.ts
//
// Task H1: a thin client that delivers ONE snapshot to the ingestion API.
// It knows nothing about scheduling or retrying — it just sends and reports
// back whether a failure is worth retrying. The loop (H2) builds on top.

import type { Snapshot } from "@kubepilot/contract";

const INGESTION_URL = process.env.INGESTION_URL ?? "http://localhost:3001";

/**
 * A push failure that tells the caller whether retrying could help.
 * The buffer/retry logic (H2) reads `.retryable` to decide keep-vs-drop.
 */
export class PushError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
        readonly status?: number,
    ) {
        super(message);
        this.name = "PushError";
    }
}

/**
 * Send one snapshot to POST /ingest.
 * Resolves on success (202). Throws PushError otherwise.
 */
export async function pushSnapshot(snapshot: Snapshot, token: string): Promise<void> {

    let res: Response;
    const ingestion_url = `${INGESTION_URL}/ingest`;

    try {
        res = await fetch(ingestion_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', // Defines the media type sent to the server
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(snapshot)
        })
    } catch (err) {
        throw new PushError(`ingestion unreachable: ${String(err)}`, true);
    }

    if (res.status === 202) {
        return;
    }

    if (res.status === 429) {
        throw new PushError("ingestion rate-limited (429)", true, res.status);
    }

    //permanent failures — if res.status is 400, 401, or 403,
    if (res.status >= 400 && res.status < 500) {
        throw new PushError(`Ingestion rejected (${res.status})`, false, res.status)
    }

    // TODO 4: anything else (5xx, or an unexpected code) is temporary →
    throw new PushError(`Ingestion error (${res.status})`, true, res.status)
}
