import type { AnalysisInput } from "../analysisInputs.js";

const CPU_HEADROOM = Number(process.env.CPU_HEADROOM ?? 0.15); // +15% cushion above p95
const MIN_REDUCTION = Number(process.env.CPU_MIN_REDUCTION ?? 0.1); // only fire if ≥10% smaller

export type Recommendation = {
  type: "cpu-rightsize";
  workloadId: string;
  namespace: string;
  name: string;
  currentCpuM: number;
  proposedCpuM: number;
  savingsM: number;
  confidence: "low" | "high";
  rationale: string;
};

/**
 * CPU request rightsizing: propose cpuP95 × (1 + headroom). Recommend-only,
 * cost-focused (reductions only). Returns null when it shouldn't fire.
 */
export function cpuRightsizing(w: AnalysisInput): Recommendation | null {
  // Guards — stay quiet rather than give bad advice. (Each narrows the type below.)
  if (w.cpuP95M == null) return null; // no measured usage → can't advise
  if (w.cpuRequestM == null) return null; // nothing reserved → nothing to shrink
  if (w.managedBy === "hpa" || w.managedBy === "vpa") return null; // autoscaler owns it

  // Proposal: normal-busy level + cushion, never below 1 millicore.
  const proposed = Math.max(1, Math.ceil(w.cpuP95M * (1 + CPU_HEADROOM)));

  // Only recommend a meaningful reduction (skip tiny changes AND under-provisioned
  // workloads, where proposed would exceed the current request).
  if (proposed > w.cpuRequestM * (1 - MIN_REDUCTION)) return null;

  const confidence = w.cpuSufficiency === "sufficient" ? "high" : "low";
  const savingsM = w.cpuRequestM - proposed;
  const headroomPct = Math.round(CPU_HEADROOM * 100);
  const rationale =
    `CPU p95 ${w.cpuP95M}m over ${w.daysOfHistory}d → request ${w.cpuRequestM}m→${proposed}m ` +
    `(+${headroomPct}% headroom, saves ${savingsM}m). Confidence ${confidence} (${w.cpuSufficiency}).`;

  return {
    type: "cpu-rightsize",
    workloadId: w.workloadId,
    namespace: w.namespace,
    name: w.name,
    currentCpuM: w.cpuRequestM,
    proposedCpuM: proposed,
    savingsM,
    confidence,
    rationale,
  };
}
