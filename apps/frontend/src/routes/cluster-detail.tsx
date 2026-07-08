import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { trpc } from "../lib/trpc";
import { timeAgo, cores, gib } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";

const STATUS_TONE = { connected: "green", stale: "amber", pending: "gray", disconnected: "red", archived: "gray" } as const;

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <motion.div variants={fadeUp}>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{title} <span className="text-muted-foreground">({count})</span></CardTitle></CardHeader>
        <CardContent className="pt-0">{count === 0 ? <p className="text-sm text-muted-foreground">None.</p> : children}</CardContent>
      </Card>
    </motion.div>
  );
}

const Th = ({ children }: { children: ReactNode }) => <th className="p-2 text-left font-medium">{children}</th>;
const Row = ({ children }: { children: ReactNode }) => <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">{children}</tr>;

export function ClusterDetailPage() {
  const { id = "" } = useParams();
  const q = trpc.clusters.detail.useQuery({ id }, { enabled: !!id });

  if (q.isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>;
  if (q.error) return <p className="text-destructive">{q.error.message}</p>;
  if (!q.data) return null;

  const { cluster, nodes, workloads, autoscalers } = q.data;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp}>
        <Link to="/app/clusters" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} /> Clusters
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{cluster.name}</h1>
          <Badge tone={STATUS_TONE[cluster.status] ?? "gray"}>{cluster.status}</Badge>
        </div>
        <p className="text-muted-foreground">
          {[cluster.provider, cluster.region, cluster.distribution].filter(Boolean).join(" · ") || "provider unknown"}
          {" · "}agent {cluster.agentVersion ?? "—"} · last seen {timeAgo(cluster.lastSeenAt)}
        </p>
      </motion.div>

      <Section title="Nodes" count={nodes.length}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><Th>Name</Th><Th>Instance</Th><Th>Capacity</Th><Th>CPU alloc</Th><Th>Mem alloc</Th><Th>Status</Th></tr></thead>
          <tbody>
            {nodes.map((n) => (
              <Row key={n.id}>
                <td className="p-2 font-medium">{n.name}</td>
                <td className="p-2 text-muted-foreground">{n.instanceType ?? "—"}</td>
                <td className="p-2 text-muted-foreground">{n.capacityProvider ?? "on-demand"}</td>
                <td className="p-2 tabular-nums">{n.cpuAllocatableM != null ? cores(n.cpuAllocatableM) : "—"}</td>
                <td className="p-2 tabular-nums">{n.memAllocatableBytes != null ? gib(n.memAllocatableBytes) : "—"}</td>
                <td className="p-2 text-muted-foreground">{n.status ?? "—"}</td>
              </Row>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Workloads" count={workloads.length}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><Th>Namespace</Th><Th>Name</Th><Th>Kind</Th><Th>Replicas</Th><Th>CPU req</Th><Th>Mem req</Th><Th>Managed by</Th></tr></thead>
          <tbody>
            {workloads.map((w) => (
              <Row key={w.id}>
                <td className="p-2 text-muted-foreground">{w.namespace}</td>
                <td className="p-2 font-medium">{w.name}</td>
                <td className="p-2 text-muted-foreground">{w.kind}</td>
                <td className="p-2 tabular-nums">{w.replicas ?? "—"}</td>
                <td className="p-2 tabular-nums">{w.cpuRequestM != null ? cores(w.cpuRequestM) : "—"}</td>
                <td className="p-2 tabular-nums">{w.memRequestBytes != null ? gib(w.memRequestBytes) : "—"}</td>
                <td className="p-2">{w.managedBy !== "none" ? <Badge tone="amber">{w.managedBy}</Badge> : <span className="text-muted-foreground">—</span>}</td>
              </Row>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Autoscalers" count={autoscalers.length}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground"><tr><Th>Kind</Th><Th>Min</Th><Th>Max</Th><Th>Metric</Th></tr></thead>
          <tbody>
            {autoscalers.map((a) => (
              <Row key={a.id}>
                <td className="p-2"><Badge tone="cyan">{a.kind}</Badge></td>
                <td className="p-2 tabular-nums">{a.minReplicas ?? "—"}</td>
                <td className="p-2 tabular-nums">{a.maxReplicas ?? "—"}</td>
                <td className="p-2 text-muted-foreground">{a.metric ?? "—"}</td>
              </Row>
            ))}
          </tbody>
        </table>
      </Section>
    </motion.div>
  );
}
