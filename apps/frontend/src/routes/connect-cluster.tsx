import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

/** A small copy-to-clipboard button with a transient "copied" tick. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ConnectClusterPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "owner" || user?.role === "admin";
  const [name, setName] = useState("");
  const connect = trpc.clusters.createConnection.useMutation();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate({ name });
  };

  // Step 2 — connection created: show the token ONCE + the install command.
  if (connect.data) {
    const { token, helmInstall } = connect.data;
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Install the agent</h1>
          <p className="text-muted-foreground">Run this in your cluster. Data appears within minutes.</p>
        </div>

        <Card className="border-amber-500/40">
          <CardHeader className="flex-row items-center gap-2">
            <TriangleAlert size={16} className="text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-amber-700 dark:text-amber-400">Copy your token now — it won't be shown again</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <code className="truncate rounded bg-muted px-2 py-1 font-mono text-xs">{token}</code>
            <CopyButton text={token} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Helm install</CardTitle>
            <CopyButton text={helmInstall} />
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{helmInstall}</pre>
          </CardContent>
        </Card>

        <Link to="/clusters" className={buttonVariants()}>Done — view clusters</Link>
      </div>
    );
  }

  // Step 1 — name the cluster.
  return (
    <div className="flex max-w-md flex-col gap-6">
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
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-us-east"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                required
              />
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? "Creating…" : "Create connection"}
              </Button>
              {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
