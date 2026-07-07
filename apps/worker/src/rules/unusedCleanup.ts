import type { AnalysisInput } from "../analysisInputs.js";

const IDLE_CPU_M = Number(process.env.CLEANUP_IDLE_CPU_M ?? 1); // ≤1 millicore over the window = effectively idle

export type CleanupRecommendation = {
  type: "cleanup";
  workloadId: string;
  namespace: string;
  name: string;
  reason: "scaled-to-zero" | "idle";
  currentReplicas: number;
  confidence: "low"; // always advisory — "consider removing", a human decides
  rationale: string;
};

/**
 * Unused-resource cleanup (conservative, ADVISORY). Flags Deployments that look
 * abandoned so a human can review deleting them.
 *
 * Scope note: the classic targets orphaned-PVCs and zero-traffic-services need
 * data we don't collect yet (PVC `mounted`, service `hasTraffic`), so this v1
 * covers only the workload signals:
 *   - scaled to 0 replicas  → likely abandoned (a fact; no history needed)
 *   - running but ~0 CPU over a SUFFICIENT window → possibly unused (gated on
 *     data-sufficiency so we never flag a brand-new or bursty-idle workload)
 */
export function unusedCleanup(w: AnalysisInput): CleanupRecommendation | null {
  if (w.kind !== "deployment") return null; // avoid DaemonSet/system-component noise
  if (w.managedBy !== "none") return null; // autoscaler-managed → not "unused"

  // Case A: scaled to zero — likely abandoned. A fact, so no history needed.
  if (w.replicas === 0) {
    return {
      type: "cleanup",
      workloadId: w.workloadId,
      namespace: w.namespace,
      name: w.name,
      reason: "scaled-to-zero",
      currentReplicas: 0,
      confidence: "low",
      rationale: "Deployment is scaled to 0 replicas — likely unused; review for deletion.",
    };
  }

  // Case B: running but effectively idle over a trustworthy window.
  if (
    w.replicas != null &&
    w.replicas > 0 &&
    w.cpuSufficiency === "sufficient" &&
    w.cpuP95M != null &&
    w.cpuP95M <= IDLE_CPU_M
  ) {
    return {
      type: "cleanup",
      workloadId: w.workloadId,
      namespace: w.namespace,
      name: w.name,
      reason: "idle",
      currentReplicas: w.replicas,
      confidence: "low",
      rationale:
        `~0 CPU (p95 ${w.cpuP95M}m) over ${w.daysOfHistory}d on ${w.replicas} replica(s) — ` +
        `possibly unused; review whether it's still needed.`,
    };
  }

  return null;
}
