import { Link } from "react-router-dom";
import { Plus, Server } from "lucide-react";
import { trpc } from "../lib/trpc";
import { timeAgo } from "../lib/format";
import { buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";

const STATUS_TONE = {
  connected: "green",
  stale: "amber",
  pending: "gray",
  disconnected: "red",
  archived: "gray",
} as const;

export function ClustersPage() {
  const clusters = trpc.clusters.list.useQuery();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
          <p className="text-muted-foreground">Connected Kubernetes clusters and their health.</p>
        </div>
        <Link to="/clusters/new" className={buttonVariants()}>
          <Plus size={16} /> Connect cluster
        </Link>
      </div>

      {clusters.isLoading && <p className="text-muted-foreground">Loading…</p>}

      {clusters.data?.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Server className="text-muted-foreground" />
          <p className="text-muted-foreground">No clusters yet. Connect one to start seeing cost & recommendations.</p>
          <Link to="/clusters/new" className={buttonVariants()}>Connect your first cluster</Link>
        </Card>
      )}

      {clusters.data && clusters.data.length > 0 && (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Region</th>
                <th className="p-3 font-medium">Nodes</th>
                <th className="p-3 font-medium">Workloads</th>
                <th className="p-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {clusters.data.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Link to={`/clusters/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[c.status] ?? "gray"}>{c.status}</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">{c.region ?? "—"}</td>
                  <td className="p-3">{c._count.nodes}</td>
                  <td className="p-3">{c._count.workloads}</td>
                  <td className="p-3 text-muted-foreground">{timeAgo(c.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
