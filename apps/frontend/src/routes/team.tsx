import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Trash2, UserPlus } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";
import { stagger, fadeUp } from "../lib/motion";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { CopyButton } from "../components/ui/copy-button";
import { Skeleton } from "../components/ui/skeleton";

const ROLES = ["admin", "viewer", "finops", "owner"] as const;
const field = "h-9 rounded-lg border border-border bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function TeamPage() {
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "admin";

  const members = trpc.invites.members.useQuery(undefined, { enabled: canManage });
  const invites = trpc.invites.list.useQuery(undefined, { enabled: canManage });
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("viewer");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const create = trpc.invites.create.useMutation({
    onSuccess: async (d) => {
      setInviteUrl(d.inviteUrl);
      setEmail("");
      await utils.invites.list.invalidate();
    },
  });
  const revoke = trpc.invites.revoke.useMutation({ onSuccess: () => utils.invites.list.invalidate() });

  if (!canManage) {
    return <div className="p-16 text-center text-muted-foreground">Only owners and admins can manage the team.</div>;
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground">Invite employees to your company and manage their roles.</p>
      </motion.div>

      {/* Invite form */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Invite an employee</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate({ email, role }); }} className="flex flex-wrap items-center gap-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" className={`${field} flex-1 min-w-[220px]`} required />
              <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className={field}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button type="submit" disabled={create.isPending}><UserPlus size={15} /> {create.isPending ? "Creating…" : "Create invite"}</Button>
            </form>
            {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
            {inviteUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <code className="flex-1 truncate font-mono text-xs">{inviteUrl}</code>
                <CopyButton text={inviteUrl} label="Copy link" />
              </div>
            )}
            {inviteUrl && <p className="text-xs text-muted-foreground">Share this link with the invitee — they'll set their own password. (In production this is emailed.)</p>}
          </CardContent>
        </Card>
      </motion.div>

      {/* Pending invites */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Pending invites {invites.data ? `(${invites.data.length})` : ""}</CardTitle></CardHeader>
          <CardContent>
            {invites.isLoading ? <Skeleton className="h-16 w-full" /> : invites.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invites.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {invites.data?.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-medium">{inv.email}</td>
                      <td className="py-2"><Badge tone="gray">{inv.role}</Badge></td>
                      <td className="py-2 text-muted-foreground">expires {timeAgo(inv.expiresAt).replace(" ago", "")}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => revoke.mutate({ id: inv.id })}><Trash2 size={14} /> Revoke</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Members */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader><CardTitle>Members {members.data ? `(${members.data.length})` : ""}</CardTitle></CardHeader>
          <CardContent>
            {members.isLoading ? <Skeleton className="h-16 w-full" /> : (
              <table className="w-full text-sm">
                <tbody>
                  {members.data?.map((m, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="py-2 font-medium">{m.name ?? m.email}</td>
                      <td className="py-2 text-muted-foreground">{m.email}</td>
                      <td className="py-2"><Badge tone={m.role === "owner" ? "green" : "gray"}>{m.role}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
