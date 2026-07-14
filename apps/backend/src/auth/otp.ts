import { randomInt } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { hashToken } from "../clusters.js";

/**
 * Email-OTP verification for company registration. The pending signup (company +
 * owner details, already password-hashed) lives in the CACHE Redis under a short
 * TTL — no DB row is created until the code is verified. The OTP itself is stored
 * only as a sha256 hash, and we cap verification attempts to blunt brute force.
 */
const redis = new Redis(config.REDIS_CACHE_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

const TTL_SECONDS = 10 * 60; // codes (and the pending signup) expire in 10 minutes
const MAX_ATTEMPTS = 5;
const key = (email: string) => `otpreg:${email.trim().toLowerCase()}`;

/** The signup details we hold until the email is verified. */
export type PendingRegistration = {
  companyName: string;
  name: string;
  email: string;
  passwordHash: string;
  otpHash: string;
  attempts: number;
};

/** Details captured at register time, minus the OTP bookkeeping we add here. */
type PendingInput = Omit<PendingRegistration, "otpHash" | "attempts">;

function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Stash a pending signup + a fresh OTP (resetting any prior one for this email),
 * and return the plaintext code so the caller can email it. Never returns the hash.
 */
export async function createPendingRegistration(input: PendingInput): Promise<string> {
  const otp = generateOtp();
  const record: PendingRegistration = { ...input, otpHash: hashToken(otp), attempts: 0 };
  await redis.set(key(input.email), JSON.stringify(record), "EX", TTL_SECONDS);
  return otp;
}

async function read(email: string): Promise<PendingRegistration | null> {
  const raw = await redis.get(key(email));
  return raw ? (JSON.parse(raw) as PendingRegistration) : null;
}

/**
 * Regenerate the OTP for an in-flight signup (resend flow), returning the new code
 * plus the company name so the caller can render the email. null if nothing pending.
 */
export async function refreshOtp(email: string): Promise<{ otp: string; companyName: string } | null> {
  const record = await read(email);
  if (!record) return null;
  const otp = generateOtp();
  record.otpHash = hashToken(otp);
  record.attempts = 0;
  await redis.set(key(email), JSON.stringify(record), "EX", TTL_SECONDS);
  return { otp, companyName: record.companyName };
}

export type VerifyResult =
  | { ok: true; registration: PendingRegistration }
  | { ok: false; reason: "expired" | "too_many_attempts" | "invalid" };

/**
 * Check a submitted code. On success the pending record is consumed (deleted) and
 * returned so the caller can create the account. On failure the attempt is counted,
 * and the record is dropped once attempts are exhausted.
 */
export async function verifyOtp(email: string, otp: string): Promise<VerifyResult> {
  const record = await read(email);
  if (!record) return { ok: false, reason: "expired" };

  if (record.otpHash === hashToken(otp.trim())) {
    await redis.del(key(email));
    return { ok: true, registration: record };
  }

  record.attempts += 1;
  if (record.attempts >= MAX_ATTEMPTS) {
    await redis.del(key(email));
    return { ok: false, reason: "too_many_attempts" };
  }
  // Preserve the remaining TTL so a wrong guess can't extend the window.
  const ttl = await redis.ttl(key(email));
  await redis.set(key(email), JSON.stringify(record), "EX", ttl > 0 ? ttl : TTL_SECONDS);
  return { ok: false, reason: "invalid" };
}
