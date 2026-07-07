import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "../config.js";
import type { SessionUser } from "../trpc/context.js";

/**
 * Server-side sessions in the CACHE Redis (separate from the BullMQ queue Redis).
 * The browser only ever holds an opaque, high-entropy session id in an httpOnly
 * cookie; the actual principal lives here and can be revoked by deleting the key.
 */
const redis = new Redis(config.REDIS_CACHE_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

export const SESSION_COOKIE = "kp_session";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const key = (sid: string) => `sess:${sid}`;

/** Create a session for a principal, return the id to put in the cookie. */
export async function createSession(user: SessionUser): Promise<string> {
  const sid = randomBytes(32).toString("base64url");
  await redis.set(key(sid), JSON.stringify(user), "EX", TTL_SECONDS);
  return sid;
}

/** Resolve a session id back to its principal (null if missing/expired). */
export async function getSession(sid: string): Promise<SessionUser | null> {
  const raw = await redis.get(key(sid));
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

/** Revoke a session (logout). */
export async function destroySession(sid: string): Promise<void> {
  await redis.del(key(sid));
}
