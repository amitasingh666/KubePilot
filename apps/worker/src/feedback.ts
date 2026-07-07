// Phase 5 — outcome feedback loop (pure detection).
//
// We can't rely on recommendation rows (they're rewritten each run), so we infer
// applied optimizations by diffing workload_revision history directly: a request
// or replica DROP between consecutive revisions = something was rightsized. Then
// we check predicted-vs-actual SAFETY — did a memory cut trigger an OOMKill after?
// — which is what makes the ≥90% accuracy KPI measurable.

const DROP = Number(process.env.FEEDBACK_MIN_DROP ?? 0.1); // ≥10% reduction counts
const SAFETY_WINDOW_MS = Number(process.env.FEEDBACK_SAFETY_DAYS ?? 7) * 24 * 60 * 60_000;

export type Revision = {
  observedAt: Date;
  cpuRequestM: number | null;
  memRequestBytes: number | null;
  replicas: number | null;
};

export type StabilityEvent = { ts: Date; kind: string };

export type Detected = {
  resource: "cpu" | "memory" | "replicas";
  fromValue: number;
  toValue: number;
  detectedAt: Date;
  safe: boolean;
  note: string;
};

// Did `cur` drop ≥DROP below `prev`? (both must be positive)
function dropped(prev: number | null, cur: number | null): boolean {
  return prev != null && cur != null && prev > 0 && cur < prev * (1 - DROP);
}

/**
 * A downsize is SAFE unless it plausibly caused a regression. Only memory cuts are
 * OOM-risky, so a memory downsize is unsafe if an OOMKill/restart landed within the
 * safety window after it. CPU/replica cuts aren't OOM-risky → safe by default.
 */
function evaluateSafety(resource: Detected["resource"], detectedAt: Date, events: StabilityEvent[]): boolean {
  if (resource !== "memory") return true;
  const until = detectedAt.getTime() + SAFETY_WINDOW_MS;
  const regressed = events.some(
    (e) =>
      (e.kind === "oomkill" || e.kind === "crashloop") &&
      e.ts.getTime() > detectedAt.getTime() &&
      e.ts.getTime() <= until,
  );
  return !regressed;
}

/**
 * Detect applied optimizations from one workload's revision history (ascending by
 * observedAt) + its stability events. Returns one Detected per resource-drop.
 */
export function detectOutcomes(revisions: Revision[], events: StabilityEvent[]): Detected[] {
  const out: Detected[] = [];
  const sorted = [...revisions].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const at = cur.observedAt;

    const checks: [Detected["resource"], number | null, number | null][] = [
      ["cpu", prev.cpuRequestM, cur.cpuRequestM],
      ["memory", prev.memRequestBytes, cur.memRequestBytes],
      ["replicas", prev.replicas, cur.replicas],
    ];
    for (const [resource, from, to] of checks) {
      if (!dropped(from, to)) continue;
      const safe = evaluateSafety(resource, at, events);
      out.push({
        resource,
        fromValue: from!,
        toValue: to!,
        detectedAt: at,
        safe,
        note: safe ? "no regression in safety window" : "OOMKill/crashloop after memory cut",
      });
    }
  }
  return out;
}
