import type { AnalysisInput } from "../analysisInputs.js";

const REPLICA_MIN = Number(process.env.REPLICA_MIN ?? 3); // only consider workloads with ≥3 replicas
const REPLICA_FLOOR = Number(process.env.REPLICA_FLOOR ?? 2); // never suggest below 2 (HA)
const UTIL_THRESHOLD = Number(process.env.REPLICA_UTIL_THRESHOLD ?? 0.2); // <20% per-replica CPU = over-provisioned signal

export type ReplicaRecommendation = {
  type: "replica-optimize";
  workloadId: string;
  namespace: string;
  name: string;
  currentReplicas: number;
  proposedReplicas: number;
  confidence: "low"; // ALWAYS advisory — our data is per-replica MAX, not total traffic
  rationale: string;
};

/**
 * Replica optimization (conservative, ADVISORY). Flags bare Deployments that run
 * many replicas while each replica barely uses its CPU — a likely over-provisioning
 * signal — and suggests reviewing a reduction toward an HA floor of 2.
 *
 * Honest limitations (why it's advisory, never high-confidence):
 *   - Usage is per-replica MAX, not total traffic, so we can't compute the exact
 *     replica count the workload's work requires — only flag the candidate.
 *   - PDB minimums aren't matched precisely (pod-label matching we don't cleanly
 *     have), so we use a safe floor of 2 instead. Exact PDB-respect is a refinement.
 */
export function replicaOptimization(w: AnalysisInput): ReplicaRecommendation | null {
  if (w.kind !== "deployment") return null; // only bare Deployments have fixed replicas we can advise
  if (w.managedBy !== "none") return null; // HPA/VPA/KEDA own the replica count
  if (w.replicas == null || w.replicas < REPLICA_MIN) return null; // not enough replicas to bother
  if (w.cpuRequestM == null || w.cpuP95M == null) return null; // need a utilization signal

  const util = w.cpuP95M / w.cpuRequestM;
  if (util >= UTIL_THRESHOLD) return null; // replicas look adequately used

  // Never propose below the HA floor OR a matching PDB's minAvailable.
  const floor = Math.max(REPLICA_FLOOR, w.pdbMinReplicas ?? 0);
  const proposed = floor;
  if (proposed >= w.replicas) return null; // nothing meaningful to reduce (or PDB forbids it)

  const pdbNote = w.pdbMinReplicas != null ? ` (respecting PDB minAvailable=${w.pdbMinReplicas})` : "";
  const rationale =
    `${w.replicas} replicas but only ~${Math.round(util * 100)}% per-replica CPU utilization over ` +
    `${w.daysOfHistory}d (advisory) → review reducing toward ${proposed}${pdbNote}. ` +
    `Heuristic flag: a precise target needs total-traffic data.`;

  return {
    type: "replica-optimize",
    workloadId: w.workloadId,
    namespace: w.namespace,
    name: w.name,
    currentReplicas: w.replicas,
    proposedReplicas: proposed,
    confidence: "low",
    rationale,
  };
}
