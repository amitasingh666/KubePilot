import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { CopyButton } from "../components/ui/copy-button";
import { fadeUp } from "../lib/motion";

export function ConnectClusterPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "owner" || user?.role === "admin";
  const [name, setName] = useState("");
  const connect = trpc.clusters.createConnection.useMutation();

  // Step 2 — connection created: show the token ONCE + the install command.
  if (connect.data) {
    const { token, helmInstall } = connect.data;
    return (
      <motion.div initial="hidden" animate="show" variants={fadeUp} className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Install the agent</h1>
          <p className="text-muted-foreground">Run this in your cluster. Data appears within minutes.</p>
        </div>

        <Card className="border-warning/40 hover:border-warning/40">
          <CardHeader className="flex-row items-center gap-2">
            <TriangleAlert size={16} className="text-warning" />
            <CardTitle className="text-warning">Copy your token now — it won't be shown again</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <code className="truncate rounded-lg bg-background/60 px-2 py-1 font-mono text-xs">{token}</code>
            <CopyButton text={token} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Helm install</CardTitle>
            <CopyButton text={helmInstall} />
          </CardHeader>
          <CardContent>
            <pre className="scroll-slim overflow-x-auto rounded-lg bg-background/60 p-3 text-xs">{helmInstall}</pre>
          </CardContent>
        </Card>

        <Link to="/clusters" className={buttonVariants()}>Done — view clusters</Link>
      </motion.div>
    );
  }

  // Step 1 — name the cluster.
  return (
    <motion.div initial="hidden" animate="show" variants={fadeUp} className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connect a cluster</h1>
        <p className="text-muted-foreground">Register a cluster to get its agent install command.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New connection</CardTitle>
          <CardDescription>Give the cluster a name you'll recognize (e.g. prod-us-east).</CardDescription>
        </CardHeader>
        <CardContent>
          {!canWrite ? (
            <p className="text-sm text-destructive">Your role ({user?.role}) can't connect clusters — ask an owner or admin.</p>
          ) : (
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); connect.mutate({ name }); }} className="flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-us-east"
                className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                required
              />
              <Button type="submit" disabled={connect.isPending}>{connect.isPending ? "Creating…" : "Create connection"}</Button>
              {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
