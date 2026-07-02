import { z } from "zod";

/**
 * Shared enumerations used across the agent, ingestion contract, and backend.
 * Kept here (not in the DB package) so the agent can depend on them without
 * pulling in Prisma.
 */

export const UserRole = z.enum(["owner", "admin", "viewer", "finops"]);
export type UserRole = z.infer<typeof UserRole>;

export const ClusterStatus = z.enum([
  "pending",
  "connected",
  "stale",
  "disconnected",
  "archived",
]);
export type ClusterStatus = z.infer<typeof ClusterStatus>;

export const WorkloadKind = z.enum([
  "deployment",
  "statefulset",
  "daemonset",
  "cronjob",
  "job",
  "replicaset",
  "rollout",
]);
export type WorkloadKind = z.infer<typeof WorkloadKind>;

export const AutoscalerKind = z.enum(["hpa", "vpa", "keda"]);
export type AutoscalerKind = z.infer<typeof AutoscalerKind>;

export const CapacityProvider = z.enum(["on-demand", "spot", "preemptible"]);
export type CapacityProvider = z.infer<typeof CapacityProvider>;

export const GitOpsController = z.enum(["none", "argocd", "flux"]);
export type GitOpsController = z.infer<typeof GitOpsController>;

/** Kinds of payload the agent can push. */
export const PayloadKind = z.enum(["inventory", "usage", "autoscalers", "events"]);
export type PayloadKind = z.infer<typeof PayloadKind>;

/** Stability signals used by the memory-safety guardrail in the engine. */
export const StabilityEventKind = z.enum([
  "oomkill",
  "restart",
  "evicted",
  "crashloop",
]);
export type StabilityEventKind = z.infer<typeof StabilityEventKind>;
