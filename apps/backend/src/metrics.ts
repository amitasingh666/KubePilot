// Minimal, dependency-free Prometheus counters. Enough for self-observability
// (request volume by route/status); a real deploy swaps in OpenTelemetry → Grafana.
const counters = new Map<string, number>();

function labelKey(name: string, labels: Record<string, string>): string {
  const inner = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, "")}"`)
    .join(",");
  return `${name}{${inner}}`;
}

export function incr(name: string, labels: Record<string, string> = {}): void {
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/** Render all counters in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines = ["# HELP http_requests_total Total HTTP requests.", "# TYPE http_requests_total counter"];
  for (const [key, value] of counters) lines.push(`${key} ${value}`);
  return lines.join("\n") + "\n";
}
