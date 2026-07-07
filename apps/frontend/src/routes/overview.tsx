import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "../lib/trpc";
import { usd, cores, gib } from "../lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

/** A headline number (the "not a chart" form for a single value). */
function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "amber" }) {
  const color = tone === "green" ? "text-primary" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Requested-vs-used meter — magnitude, single hue. Low % = over-provisioned. */
function Meter({ label, used, requested, fmt }: { label: string; used: number; requested: number; fmt: (n: number) => string }) {
  const pct = requested > 0 ? Math.min(100, Math.round((used / requested) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {fmt(used)} / {fmt(requested)} <span className="tabular-nums">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const cost = trpc.cost.overview.useQuery();
  const util = trpc.utilization.overview.useQuery();

  const c = cost.data;
  // Prefer namespace breakdown; fall back to per-cluster.
  const chartData = (c?.topNamespaces.length ? c.topNamespaces : c?.byCluster ?? []).slice(0, 8);

  const realizabilityTone = c?.realizability === "auto" ? "green" : c?.realizability === "manual" ? "amber" : "gray";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Current spend, savings potential, and utilization.</p>
      </div>

      {/* Headline numbers — realized vs waste shown as DISTINCT tiles (never summed). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Monthly cost" value={usd(c?.totalMonthlyUsd)} hint="current, node-based" />
        <StatTile label="Realized savings / mo" value={usd(c?.realizedMonthlyUsd)} hint="nodes & volumes freed" tone="green" />
        <StatTile label="Waste / mo" value={usd(c?.wasteMonthlyUsd)} hint="freed requests (not yet $)" tone="amber" />
        <Card>
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Realizability</div>
            <div className="mt-2">
              <Badge tone={realizabilityTone}>{c?.realizability ?? "—"}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">auto = Karpenter/CA removes nodes</div>
          </CardContent>
        </Card>
      </div>

      {/* Utilization meters */}
      <Card>
        <CardHeader>
          <CardTitle>Utilization — requested vs used</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {util.data ? (
            <>
              <Meter label="CPU" used={util.data.cpu.usedM} requested={util.data.cpu.requestedM} fmt={cores} />
              <Meter label="Memory" used={util.data.memory.usedBytes} requested={util.data.memory.requestedBytes} fmt={gib} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      {/* Cost by namespace — single-series bar (one hue), recessive grid, hover tooltip. */}
      <Card>
        <CardHeader>
          <CardTitle>Cost by {c?.topNamespaces.length ? "namespace" : "cluster"} ($/mo)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cost data yet — connect a cluster and let analysis run.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 40)}>
              <BarChart layout="vertical" data={chartData} margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis type="number" tickFormatter={(v) => usd(v)} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis type="category" dataKey="name" width={120} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  formatter={(v) => [usd(Number(v)), "cost/mo"]}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="monthlyUsd" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))">
                  {chartData.map((_, i) => (
                    <Cell key={i} fill="hsl(var(--primary))" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
