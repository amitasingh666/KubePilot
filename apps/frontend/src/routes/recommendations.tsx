import { useState } from "react";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { trpc } from "../lib/trpc";
import { usd, cores, gib } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { toCsv, downloadCsv, reportFilename } from "../lib/csv";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { CopyButton } from "../components/ui/copy-button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

function fmtVal(unit: string, v: number | null): string {
  if (v == null) return "—";
  if (unit === "millicores") return cores(v);
  if (unit === "bytes") return gib(v);
  return String(v);
}

const TYPE_LABEL: Record<string, string> = {
  "cpu-rightsize": "CPU rightsize",
  "memory-rightsize": "Memory rightsize",
  "replica-optimize": "Replica optimize",
  "node-consolidate": "Node consolidate",
  "pvc-cleanup": "PVC cleanup",
  cleanup: "Cleanup",
};

export function RecommendationsPage() {
  const q = trpc.recommendations.list.useQuery();
  const [filter, setFilter] = useState("all");

  const all = q.data ?? [];
  const types = ["all", ...Array.from(new Set(all.map((r) => r.type)))];
  const shown = filter === "all" ? all : all.filter((r) => r.type === filter);

  const exportCsv = () => {
    const csv = toCsv(shown, [
      { header: "type", get: (r) => r.type },
      { header: "namespace", get: (r) => r.targetNamespace ?? "" },
      { header: "target", get: (r) => r.targetName ?? "" },
      { header: "resource", get: (r) => r.resource },
      { header: "unit", get: (r) => r.unit },
      { header: "current", get: (r) => r.currentValue ?? "" },
      { header: "proposed", get: (r) => r.proposedValue ?? "" },
      { header: "savings_usd_per_mo", get: (r) => r.savingsUsd ?? "" },
      { header: "savings_kind", get: (r) => r.savingsKind ?? "" },
      { header: "confidence", get: (r) => r.confidence },
    ]);
    downloadCsv(reportFilename("recommendations"), csv);
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recommendations</h1>
          <p className="text-muted-foreground">Ranked by monthly savings. Recommend-only — copy the patch to apply.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
          <Download size={14} /> Export CSV
        </Button>
      </motion.div>

      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-all",
              filter === t ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t === "all" ? "All" : TYPE_LABEL[t] ?? t}
          </button>
        ))}
      </motion.div>

      {q.isLoading && (
        <motion.div variants={fadeUp} className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </motion.div>
      )}

      {q.data && shown.length === 0 && (
        <motion.div variants={fadeUp}>
          <Card><CardContent className="p-8 text-center text-muted-foreground">No recommendations. Run analysis after a cluster reports data.</CardContent></Card>
        </motion.div>
      )}

      <div className="flex flex-col gap-3">
        {shown.map((r) => (
          <motion.div key={r.id} variants={fadeUp}>
            <Card className="hover:-translate-y-0.5">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="cyan">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                      <span className="font-medium">{r.targetNamespace ? `${r.targetNamespace}/` : ""}{r.targetName}</span>
                    </div>
                    {r.currentValue != null && (
                      <div className="mt-1.5 text-sm text-muted-foreground">
                        {r.resource}: <span className="tabular-nums line-through decoration-destructive/40">{fmtVal(r.unit, r.currentValue)}</span>
                        {" → "}
                        <span className="font-medium tabular-nums text-primary">{fmtVal(r.unit, r.proposedValue)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.savingsKind && <Badge tone={r.savingsKind === "realized" ? "green" : "amber"}>{r.savingsKind}</Badge>}
                    <Badge tone={r.confidence === "high" ? "green" : "gray"}>{r.confidence}</Badge>
                    <span className="text-lg font-bold tabular-nums">{usd(r.savingsUsd)}<span className="text-xs font-normal text-muted-foreground">/mo</span></span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">{r.rationale}</p>

                {r.patch && (
                  <details className="group rounded-lg border border-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
                      <span>View patch <span className="opacity-60">({r.patchMode ?? "kubectl"})</span></span>
                      <span className="transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <div className="border-t border-border p-3">
                      <div className="mb-2 flex justify-end"><CopyButton text={r.patch} /></div>
                      <pre className="scroll-slim overflow-x-auto rounded-lg bg-background/60 p-3 text-xs">{r.patch}</pre>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
