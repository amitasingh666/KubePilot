import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Server } from "lucide-react";
import { trpc } from "../lib/trpc";
import { timeAgo } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";

const STATUS_TONE = { connected: "green", stale: "amber", pending: "gray", disconnected: "red", archived: "gray" } as const;

export function ClustersPage() {
  const clusters = trpc.clusters.list.useQuery();

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
          <p className="text-muted-foreground">Connected Kubernetes clusters and their health.</p>
        </div>
        <Link to="/app/clusters/new" className={buttonVariants()}>
          <Plus size={16} /> Connect cluster
        </Link>
      </motion.div>

      {clusters.isLoading && (
        <motion.div variants={fadeUp}><Skeleton className="h-40 w-full rounded-xl" /></motion.div>
      )}

      {clusters.data?.length === 0 && (
        <motion.div variants={fadeUp}>
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><Server /></span>
            <p className="text-muted-foreground">No clusters yet. Connect one to start seeing cost & recommendations.</p>
            <Link to="/app/clusters/new" className={buttonVariants()}>Connect your first cluster</Link>
          </Card>
        </motion.div>
      )}

      {clusters.data && clusters.data.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Region</th>
                  <th className="p-4 font-medium">Nodes</th>
                  <th className="p-4 font-medium">Workloads</th>
                  <th className="p-4 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {clusters.data.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                    <td className="p-4">
                      <Link to={`/app/clusters/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                    </td>
                    <td className="p-4"><Badge tone={STATUS_TONE[c.status] ?? "gray"}>{c.status}</Badge></td>
                    <td className="p-4 text-muted-foreground">{c.region ?? "—"}</td>
                    <td className="p-4 tabular-nums">{c._count.nodes}</td>
                    <td className="p-4 tabular-nums">{c._count.workloads}</td>
                    <td className="p-4 text-muted-foreground">{timeAgo(c.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
