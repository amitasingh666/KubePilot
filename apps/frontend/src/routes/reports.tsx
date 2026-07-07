import { useState } from "react";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { trpc } from "../lib/trpc";
import { usd } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { toCsv, downloadCsv, reportFilename } from "../lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

const SCOPES = [
  { key: "cluster", label: "By cluster" },
  { key: "namespace", label: "By namespace" },
  { key: "workload", label: "By deployment" },
] as const;

type Scope = (typeof SCOPES)[number]["key"];

export function ReportsPage() {
  const breakdown = trpc.cost.breakdown.useQuery();
  const recs = trpc.recommendations.list.useQuery();
  const [scope, setScope] = useState<Scope>("cluster");

  const rows = (breakdown.data ?? []).filter((r) => r.scope === scope);
  const total = rows.reduce((s, r) => s + r.monthlyUsd, 0);

  const exportCost = () => {
    const csv = toCsv(rows, [
      { header: "scope", get: (r) => r.scope },
      { header: "namespace", get: (r) => r.namespace ?? "" },
      { header: "name", get: (r) => r.name },
      { header: "monthly_usd", get: (r) => r.monthlyUsd },
    ]);
    downloadCsv(reportFilename(`cost-by-${scope}`), csv);
  };

  const exportRecs = () => {
    const data = recs.data ?? [];
    const csv = toCsv(data, [
      { header: "type", get: (r) => r.type },
      { header: "namespace", get: (r) => r.targetNamespace ?? "" },
      { header: "target", get: (r) => r.targetName ?? "" },
      { header: "savings_usd_per_mo", get: (r) => r.savingsUsd ?? "" },
      { header: "savings_kind", get: (r) => r.savingsKind ?? "" },
      { header: "confidence", get: (r) => r.confidence },
    ]);
    downloadCsv(reportFilename("recommendations"), csv);
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Cost by cluster, namespace, or deployment — export to CSV.</p>
      </motion.div>

      {/* Recommendations export card */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <div className="font-medium">Recommendations report</div>
              <div className="text-sm text-muted-foreground">{recs.data?.length ?? 0} recommendations, ranked by savings</div>
            </div>
            <Button variant="outline" size="sm" onClick={exportRecs} disabled={!recs.data?.length}>
              <Download size={14} /> Export CSV
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Cost report */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Cost report</CardTitle>
            <Button variant="outline" size="sm" onClick={exportCost} disabled={rows.length === 0}>
              <Download size={14} /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-2">
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScope(s.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                    scope === s.key ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {breakdown.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cost data for this scope yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    {scope !== "cluster" && <th className="p-2 font-medium">Namespace</th>}
                    <th className="p-2 font-medium">{scope === "cluster" ? "Cluster" : scope === "namespace" ? "Namespace" : "Deployment"}</th>
                    <th className="p-2 text-right font-medium">Monthly cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      {scope !== "cluster" && <td className="p-2 text-muted-foreground">{r.namespace ?? "—"}</td>}
                      <td className="p-2 font-medium">{r.name}</td>
                      <td className="p-2 text-right tabular-nums">{usd(r.monthlyUsd)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="p-2" colSpan={scope === "cluster" ? 1 : 2}>Total</td>
                    <td className="p-2 text-right tabular-nums">{usd(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
