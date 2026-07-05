
// Where Prometheus lives. Local dev = the port-forward you have running.
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";

// One row of an instant-query result, cleaned up for callers.
export type VectorSample = {
  metric: Record<string, string>; // the label set, e.g. { namespace: "shop", pod: "..." }
  value: number;                   // already parsed from Prometheus's string
};

/**
 * Run an instant PromQL query and return the result rows.
 * Throws a clear Error on network failure, HTTP error, or a Prometheus-level error.
 */
export async function instantQuery(promql: string): Promise<VectorSample[]> {

  const endpoint =  `${PROMETHEUS_URL}/api/v1/query?${new URLSearchParams({ query: promql })}`

  const res = await fetch(endpoint);

  if (!res.ok) throw new Error(`Prometheus HTTP ${res.status}`);

  const json = (await res.json()) as {
    status: string;
    error?: string;
    data?: { result: Array<{ metric: Record<string, string>; value: [number, string] }> };
  };

  // A 200 doesn't mean success — Prometheus signals query errors in the body.
  // This also guards the json.data access below (no `data` field on errors).
  if (json.status !== "success") {
    throw new Error(`Prometheus query failed: ${json.error ?? "unknown error"}`);
  }

  const rows = json.data!.result;

  return rows.map((row) => ({
    metric: row.metric,
    value: Number(row.value[1]),
  }));

}

// --- usage query config -----------------------------------------------------
// All windows are configurable via env so local dev (a ~hours-old cluster) can
// use a short window while production uses days. The recommendation engine wants
// CPU p95 over ≥7d and memory MAX over 14–30d (02-Architecture §3.5).

/** Range for quantile_over_time / max_over_time (the observation window). */
export const USAGE_WINDOW = process.env.USAGE_WINDOW ?? "7d";
/** Inner rate() window for the CPU counter. */
export const USAGE_RATE_WINDOW = process.env.USAGE_RATE_WINDOW ?? "5m";
/** Subquery resolution — how often the inner expression is sampled. */
export const USAGE_STEP = process.env.USAGE_STEP ?? "5m";

/** Parse a Prometheus-style duration ("30m", "7d") to seconds. */
export function durationToSeconds(d: string): number {
  const m = d.match(/^(\d+)(s|m|h|d|w)$/);
  if (!m) throw new Error(`invalid duration: "${d}" (expected e.g. 30m, 6h, 7d)`);
  const unitSec: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return parseInt(m[1]!, 10) * unitSec[m[2]!]!;
}

/** windowSec for the contract, derived once from the configured window. */
export const USAGE_WINDOW_SEC = durationToSeconds(USAGE_WINDOW);

// --- self-throttling --------------------------------------------------------
// The agent must never overwhelm the customer's production Prometheus
// (02-Architecture §3.1 "Prometheus safety"; 06-Tech-Stack §2 "p-limit + range
// caps"). We bound concurrent queries with a tiny semaphore and cap the range.

const MAX_CONCURRENCY = Number(process.env.PROM_MAX_CONCURRENCY ?? 2);
/** Reject absurd windows so a misconfig can't ask Prometheus for years of data. */
const MAX_RANGE_SECONDS = durationToSeconds(process.env.PROM_MAX_RANGE ?? "30d");

let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiters.shift()?.();
}

/** instantQuery routed through the concurrency gate. Use this for usage queries. */
export async function throttledQuery(promql: string): Promise<VectorSample[]> {
  await acquire();
  try {
    return await instantQuery(promql);
  } finally {
    release();
  }
}

function assertWindowWithinCap(): void {
  if (USAGE_WINDOW_SEC > MAX_RANGE_SECONDS) {
    throw new Error(
      `USAGE_WINDOW=${USAGE_WINDOW} (${USAGE_WINDOW_SEC}s) exceeds the safety cap ${MAX_RANGE_SECONDS}s`,
    );
  }
}

// --- Task ④: metric-compatibility probe -------------------------------------
// Before trusting the usage path, confirm the customer's Prometheus actually has
// the cAdvisor series we depend on. These are effectively universal, but a probe
// turns "silently empty usage" into a clear, actionable onboarding signal.

export type MetricProbe = { cpu: boolean; memory: boolean; ok: boolean };

export async function probeMetricCompatibility(): Promise<MetricProbe> {
  const has = async (metric: string): Promise<boolean> => {
    try {
      const rows = await throttledQuery(`count(${metric})`);
      return rows.length > 0 && rows[0]!.value > 0;
    } catch {
      return false;
    }
  };
  const [cpu, memory] = await Promise.all([
    has("container_cpu_usage_seconds_total"),
    has("container_memory_working_set_bytes"),
  ]);
  return { cpu, memory, ok: cpu && memory };
}

// --- Task ②: CPU p95 per pod (cAdvisor only, no kube-state-metrics) ----------
// Returns a map of "namespace/pod" → CPU p95 in millicores. Attribution to a
// workload happens in usage.ts via the K8s API (see the customer-cluster note:
// we never depend on KSM being present in the customer's Prometheus).
//
//   rate(...[5m])                          counter → cores per pod-container
//   sum by (namespace, pod) (...)          collapse containers → per-pod cores
//   quantile_over_time(0.95, (...)[7d:5m]) p95 of that over the window
//
// container!="" and container!="POD" drop cAdvisor's per-pod rollup rows and the
// pause container.
export async function queryPodCpuP95(): Promise<Map<string, number>> {
  assertWindowWithinCap();
  const q =
    `quantile_over_time(0.95, ` +
    `sum by (namespace, pod) (` +
    `rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[${USAGE_RATE_WINDOW}])` +
    `)[${USAGE_WINDOW}:${USAGE_STEP}])`;
  const rows = await throttledQuery(q);
  const out = new Map<string, number>();
  for (const r of rows) {
    const ns = r.metric.namespace;
    const pod = r.metric.pod;
    if (!ns || !pod || !Number.isFinite(r.value)) continue;
    // cores → millicores, clamp to a non-negative integer for the contract.
    out.set(`${ns}/${pod}`, Math.max(0, Math.round(r.value * 1000)));
  }
  return out;
}

// --- Task ③: memory MAX per pod (peak working set, never a percentile) -------
// MAX because memory is non-compressible — sizing below the observed peak risks
// OOMKills (02-Architecture §3.5, CRIT-3). Returns "namespace/pod" → bytes.
export async function queryPodMemMax(): Promise<Map<string, number>> {
  assertWindowWithinCap();
  const q =
    `max_over_time(` +
    `sum by (namespace, pod) (` +
    `container_memory_working_set_bytes{container!="",container!="POD"}` +
    `)[${USAGE_WINDOW}:${USAGE_STEP}])`;
  const rows = await throttledQuery(q);
  const out = new Map<string, number>();
  for (const r of rows) {
    const ns = r.metric.namespace;
    const pod = r.metric.pod;
    if (!ns || !pod || !Number.isFinite(r.value)) continue;
    out.set(`${ns}/${pod}`, Math.max(0, Math.round(r.value)));
  }
  return out;
}