import type { AnalysisInput } from "../analysisInputs.js";

const MEM_BUFFER = Number(process.env.MEM_BUFFER ?? 0.15); // +15% above the observed peak
const MIN_REDUCTION = Number(process.env.MEM_MIN_REDUCTION ?? 0.1); // only fire if ≥10% smaller

export type MemRecommendation = {
  type: "memory-rightsize";
  workloadId: string;
  namespace: string;
  name: string;
  currentMemBytes: number;
  proposedMemBytes: number; // proposed request AND limit (limit == request → Guaranteed QoS)
  savingsBytes: number;
  confidence: "low" | "high";
  rationale: string;
};

const mib = (b: number) => `${Math.round(b / 1048576)}Mi`;

/**
 * Memory request rightsizing: propose peak (MAX) × (1 + buffer), and set the
 * limit equal to the request (Guaranteed QoS). Memory is non-compressible, so
 * this is the dangerous one — we size to the observed peak (never a percentile)
 * and refuse to touch a workload that's been restarting (possible OOMKills).
 */
export function memoryRightsizing(w: AnalysisInput): MemRecommendation | null {
  // Guards — stay quiet rather than risk an OOMKill. (Each narrows the type below.)
  if (w.memMaxBytes == null) return null; // no measured usage
  if (w.memRequestBytes == null) return null; // nothing reserved to shrink
  if (w.managedBy === "hpa" || w.managedBy === "vpa") return null; // autoscaler owns it
  if (w.restarts > 0) return null; // OOM safety: never lower a restarting workload (raise-only is a separate rule)

  // Proposal: observed PEAK + buffer (MAX, never a percentile — memory can't burst).
  const proposed = Math.max(1, Math.ceil(w.memMaxBytes * (1 + MEM_BUFFER)));

  // Only recommend a meaningful reduction (also skips under-provisioned workloads).
  if (proposed > w.memRequestBytes * (1 - MIN_REDUCTION)) return null;

  const confidence = w.memSufficiency === "sufficient" ? "high" : "low";
  const savingsBytes = w.memRequestBytes - proposed;
  const bufferPct = Math.round(MEM_BUFFER * 100);
  const rationale =
    `mem MAX ${mib(w.memMaxBytes)} over ${w.daysOfHistory}d → request ${mib(w.memRequestBytes)}→${mib(proposed)} ` +
    `(+${bufferPct}% buffer, saves ${mib(savingsBytes)}); set limit==request (Guaranteed QoS). ` +
    `Confidence ${confidence} (${w.memSufficiency}).`;

  return {
    type: "memory-rightsize",
    workloadId: w.workloadId,
    namespace: w.namespace,
    name: w.name,
    currentMemBytes: w.memRequestBytes,
    proposedMemBytes: proposed,
    savingsBytes,
    confidence,
    rationale,
  };
}
