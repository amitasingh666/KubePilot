import { z } from "zod";
import {
  AutoscalerKind,
  CapacityProvider,
  GitOpsController,
  PayloadKind,
  StabilityEventKind,
  WorkloadKind,
} from "./enums.js";

/**
 * Ingestion Contract v2 — the single shared schema between the agent and the
 * backend. Imported by BOTH so the wire format can never drift silently.
 *
 * Design notes (from 02-Architecture.md v2.0):
 *   - CPU is reported as p95; MEMORY as MAX (working set) → OOM-safe sizing.
 *   - Usage is aggregated at WORKLOAD level (never per ephemeral pod).
 *   - Every push carries an idempotency key for safe at-least-once delivery.
 *   - Secrets are already stripped by the agent (env values, args, non-allowlisted
 *     annotations) BEFORE anything reaches this contract.
 */

export const AGENT_CONTRACT_VERSION = "2.0" as const;

// --- primitives -------------------------------------------------------------

/** CPU in millicores (e.g. 1500 = 1.5 cores). */
export const Millicores = z.number().int().nonnegative();
/** Memory / storage in bytes. */
export const Bytes = z.number().int().nonnegative();
export const Iso = z.string().datetime();

/**
 * Structured idempotency key. The agent serializes this deterministically into
 * `Snapshot.idempotencyKey`; the backend dedupes on it.
 */
export const IdempotencyKey = z.object({
  clusterId: z.string().uuid(),
  target: z.string(), // workload/node ref, or "inventory"
  windowStart: Iso,
  windowEnd: Iso,
  agentVersion: z.string(),
});
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

// --- inventory --------------------------------------------------------------

export const ResourceQuantities = z.object({
  cpuRequestMillicores: Millicores.nullish(),
  cpuLimitMillicores: Millicores.nullish(),
  memRequestBytes: Bytes.nullish(),
  memLimitBytes: Bytes.nullish(),
});
export type ResourceQuantities = z.infer<typeof ResourceQuantities>;

export const NodeInventory = z.object({
  name: z.string(),
  nodeGroup: z.string().nullish(),
  instanceType: z.string().nullish(),
  capacityProvider: CapacityProvider.nullish(),
  cpuCapacityMillicores: Millicores.nullish(),
  memCapacityBytes: Bytes.nullish(),
  cpuAllocatableMillicores: Millicores.nullish(),
  memAllocatableBytes: Bytes.nullish(),
  taints: z.array(z.record(z.string(), z.unknown())).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  status: z.string().nullish(),
});
export type NodeInventory = z.infer<typeof NodeInventory>;

export const ContainerSpec = z.object({
  name: z.string(),
  resources: ResourceQuantities,
});
export type ContainerSpec = z.infer<typeof ContainerSpec>;

/** Scheduling facts needed for constraint-aware bin-packing / drain feasibility. */
export const SchedulingConstraint = z.object({
  nodeSelector: z.record(z.string(), z.string()).nullish(),
  affinity: z.record(z.string(), z.unknown()).nullish(),
  antiAffinity: z.record(z.string(), z.unknown()).nullish(),
  tolerations: z.array(z.record(z.string(), z.unknown())).nullish(),
  topologySpread: z.array(z.record(z.string(), z.unknown())).nullish(),
  pvcAffinity: z.record(z.string(), z.unknown()).nullish(),
});
export type SchedulingConstraint = z.infer<typeof SchedulingConstraint>;

export const WorkloadInventory = z.object({
  namespace: z.string(),
  name: z.string(),
  kind: WorkloadKind,
  replicas: z.number().int().nonnegative().nullish(),
  resources: ResourceQuantities,
  containers: z.array(ContainerSpec).default([]),
  qosClass: z.string().nullish(),
  priorityClass: z.string().nullish(),
  /** none | hpa | vpa | keda — denormalized for quick rule gating. */
  managedBy: z.string().default("none"),
  gitopsOwned: z.boolean().default(false),
  gitopsSource: z.record(z.string(), z.unknown()).nullish(),
  labels: z.record(z.string(), z.string()).default({}),
  /** Pod-TEMPLATE labels (spec.template.metadata.labels) — what PDBs/Services select on. Optional for backward-compat. */
  podLabels: z.record(z.string(), z.string()).nullish(),
  constraints: SchedulingConstraint.nullish(),
});
export type WorkloadInventory = z.infer<typeof WorkloadInventory>;

export const AutoscalerInventory = z.object({
  kind: AutoscalerKind,
  namespace: z.string(),
  targetWorkload: z.string(),
  targetKind: WorkloadKind.nullish(),
  minReplicas: z.number().int().nonnegative().nullish(),
  maxReplicas: z.number().int().nonnegative().nullish(),
  metric: z.string().nullish(), // cpu | memory | custom | external
  target: z.record(z.string(), z.unknown()).nullish(),
  updateMode: z.string().nullish(), // vpa: Off | Initial | Auto | Recreate
});
export type AutoscalerInventory = z.infer<typeof AutoscalerInventory>;

export const PdbInventory = z.object({
  namespace: z.string(),
  name: z.string(),
  minAvailable: z.string().nullish(),
  maxUnavailable: z.string().nullish(),
  selector: z.record(z.string(), z.unknown()).nullish(),
});
export type PdbInventory = z.infer<typeof PdbInventory>;

export const PvcInventory = z.object({
  namespace: z.string(),
  name: z.string(),
  storageClass: z.string().nullish(),
  capacityBytes: Bytes.nullish(),
  volumeType: z.string().nullish(),
  bound: z.boolean().nullish(),
  mounted: z.boolean().nullish(),
});
export type PvcInventory = z.infer<typeof PvcInventory>;

export const ServiceInventory = z.object({
  namespace: z.string(),
  name: z.string(),
  type: z.string().nullish(),
  hasTraffic: z.boolean().nullish(),
});
export type ServiceInventory = z.infer<typeof ServiceInventory>;

export const InventoryPayload = z.object({
  nodes: z.array(NodeInventory).default([]),
  workloads: z.array(WorkloadInventory).default([]),
  autoscalers: z.array(AutoscalerInventory).default([]),
  pdbs: z.array(PdbInventory).default([]),
  pvcs: z.array(PvcInventory).default([]),
  services: z.array(ServiceInventory).default([]),
});
export type InventoryPayload = z.infer<typeof InventoryPayload>;

// --- usage ------------------------------------------------------------------

export const WorkloadUsage = z.object({
  namespace: z.string(),
  workload: z.string(),
  kind: WorkloadKind,
  windowStart: Iso,
  windowEnd: Iso,
  windowSec: z.number().int().positive(),
  cpuP95Millicores: Millicores,
  cpuAvgMillicores: Millicores.nullish(),
  memMaxBytes: Bytes, // MAX — required for safe memory sizing
  memAvgBytes: Bytes.nullish(),
  restarts: z.number().int().nonnegative().default(0),
});
export type WorkloadUsage = z.infer<typeof WorkloadUsage>;

export const NodeUsage = z.object({
  node: z.string(),
  windowStart: Iso,
  windowEnd: Iso,
  windowSec: z.number().int().positive(),
  cpuUsedMillicores: Millicores.nullish(),
  memUsedBytes: Bytes.nullish(),
  cpuAllocatablePct: z.number().min(0).max(100).nullish(),
  memAllocatablePct: z.number().min(0).max(100).nullish(),
});
export type NodeUsage = z.infer<typeof NodeUsage>;

export const UsagePayload = z.object({
  workloads: z.array(WorkloadUsage).default([]),
  nodes: z.array(NodeUsage).default([]),
});
export type UsagePayload = z.infer<typeof UsagePayload>;

// --- events -----------------------------------------------------------------

export const StabilityEvent = z.object({
  namespace: z.string().nullish(),
  workload: z.string().nullish(),
  ts: Iso,
  kind: StabilityEventKind,
  detail: z.record(z.string(), z.unknown()).nullish(),
});
export type StabilityEvent = z.infer<typeof StabilityEvent>;

export const EventsPayload = z.object({
  events: z.array(StabilityEvent).default([]),
});
export type EventsPayload = z.infer<typeof EventsPayload>;

// --- snapshot envelope ------------------------------------------------------

export const Snapshot = z
  .object({
    contractVersion: z.literal(AGENT_CONTRACT_VERSION),
    agentVersion: z.string(),
    clusterId: z.string().uuid(),
    capturedAt: Iso,
    /** Deterministic serialization of `IdempotencyKey`. */
    idempotencyKey: z.string().min(1),
    payloadKind: PayloadKind,
    gitopsController: GitOpsController.default("none"),
    inventory: InventoryPayload.nullish(),
    usage: UsagePayload.nullish(),
    events: EventsPayload.nullish(),
  })
  .superRefine((snap, ctx) => {
    // The declared payloadKind must carry a matching body.
    const requireField = (field: keyof typeof snap, kind: string) => {
      if (snap.payloadKind === kind && !snap[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `payloadKind="${kind}" requires a "${String(field)}" body`,
          path: [String(field)],
        });
      }
    };
    requireField("inventory", "inventory");
    requireField("usage", "usage");
    requireField("events", "events");
    // "autoscalers" ride inside the inventory body.
    if (snap.payloadKind === "autoscalers" && !snap.inventory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `payloadKind="autoscalers" requires an "inventory" body`,
        path: ["inventory"],
      });
    }
  });
export type Snapshot = z.infer<typeof Snapshot>;

/** Deterministically serialize an idempotency key to a stable string. */
export function serializeIdempotencyKey(k: IdempotencyKey): string {
  return [k.clusterId, k.target, k.windowStart, k.windowEnd, k.agentVersion].join("|");
}
