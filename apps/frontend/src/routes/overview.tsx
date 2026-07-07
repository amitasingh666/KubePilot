import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { Wallet, PiggyBank, Trash2, Sparkles, Cpu, MemoryStick } from "lucide-react";
import { trpc } from "../lib/trpc";
import { usd, cores, gib } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { StatTile } from "../components/ui/stat-tile";
import { Skeleton } from "../components/ui/skeleton";

function Meter({ label, used, requested, fmt, icon: Icon }: { label: string; used: number; requested: number; fmt: (n: number) => string; icon: typeof Cpu }) {
  const pct = requested > 0 ? Math.min(100, Math.round((used / requested) * 100)) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium"><Icon size={15} className="text-muted-foreground" /> {label}</span>
        <span className="text-muted-foreground">
          {fmt(used)} / {fmt(requested)} <span className="ml-1 font-semibold tabular-nums text-foreground">{pct}%</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-gradient-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const cost = trpc.cost.overview.useQuery();
  const util = trpc.utilization.overview.useQuery();
  const feedback = trpc.feedback.summary.useQuery();
  const c = cost.data;
  const chartData = (c?.topNamespaces.length ? c.topNamespaces : c?.byCluster ?? []).slice(0, 8);
  const realizabilityTone = c?.realizability === "auto" ? "green" : c?.realizability === "manual" ? "amber" : "gray";

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Current spend, savings potential, and utilization.</p>
      </motion.div>

      {/* Headline numbers — realized vs waste as DISTINCT tiles (never summed). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Monthly cost" value={c?.totalMonthlyUsd ?? 0} format={usd} icon={Wallet} hint="current, node-based" loading={cost.isLoading} />
        <StatTile label="Realized / mo" value={c?.realizedMonthlyUsd ?? 0} format={usd} icon={PiggyBank} tone="primary" hint="nodes & volumes freed" loading={cost.isLoading} />
        <StatTile label="Waste / mo" value={c?.wasteMonthlyUsd ?? 0} format={usd} icon={Trash2} tone="warning" hint="freed requests (not yet $)" loading={cost.isLoading} />
        <motion.div variants={fadeUp}>
          <Card className="group p-5 hover:-translate-y-0.5 hover:shadow-glow">
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Realizability</span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent transition-transform group-hover:scale-110"><Sparkles size={16} /></span>
            </div>
            <div className="mt-3"><Badge tone={realizabilityTone} className="text-sm">{c?.realizability ?? "—"}</Badge></div>
            <div className="mt-1 text-xs text-muted-foreground">auto = Karpenter/CA removes nodes</div>
          </Card>
        </motion.div>
      </div>

      {/* Utilization */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Utilization — requested vs used</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {util.data ? (
              <>
                <Meter label="CPU" icon={Cpu} used={util.data.cpu.usedM} requested={util.data.cpu.requestedM} fmt={cores} />
                <Meter label="Memory" icon={MemoryStick} used={util.data.memory.usedBytes} requested={util.data.memory.requestedBytes} fmt={gib} />
              </>
            ) : (
              <><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recommendation accuracy — the feedback loop's headline. */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Recommendation accuracy</CardTitle></CardHeader>
          <CardContent>
            {feedback.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !feedback.data || feedback.data.detected === 0 ? (
              <p className="text-sm text-muted-foreground">
                No applied optimizations detected yet — accuracy appears once workloads are rightsized and revision history builds up.
              </p>
            ) : (
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-3xl font-bold tabular-nums text-primary">{feedback.data.accuracyPct}%</div>
                  <div className="text-xs text-muted-foreground">stayed safe after change</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {feedback.data.safe} of {feedback.data.detected} detected optimizations had no post-change regression
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {feedback.data.recent.slice(0, 6).map((o, i) => (
                      <Badge key={i} tone={o.safe ? "green" : "red"}>{o.resource}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Cost by namespace/cluster — single-series gradient bar, animated. */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Cost by {c?.topNamespaces.length ? "namespace" : "cluster"} ($/mo)</CardTitle></CardHeader>
          <CardContent>
            {cost.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cost data yet — connect a cluster and let analysis run.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 42)}>
                <BarChart layout="vertical" data={chartData} margin={{ left: 8, right: 28 }}>
                  <defs>
                    <linearGradient id="barfill" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--primary))" />
                      <stop offset="100%" stopColor="hsl(var(--accent))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                  <XAxis type="number" tickFormatter={(v) => usd(v)} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={130} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    formatter={(v) => [usd(Number(v)), "cost/mo"]}
                    contentStyle={{ background: "hsl(var(--elevated))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                  />
                  <Bar dataKey="monthlyUsd" radius={[0, 6, 6, 0]} fill="url(#barfill)" animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
