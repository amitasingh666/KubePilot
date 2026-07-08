import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Gauge } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

const field =
  "h-10 rounded-lg border border-border bg-background/60 px-3 text-sm transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const info = trpc.auth.inviteInfo.useQuery({ token }, { enabled: !!token, retry: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const utils = trpc.useUtils();
  const accept = trpc.auth.acceptInvite.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/app");
    },
  });

  if (!isLoading && user) return <Navigate to="/app" replace />;

  const invalid = !token || info.isError;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.7)]">
            <Gauge size={24} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            {invalid ? "Invite not valid" : <>Join <span className="text-gradient">{info.data?.companyName}</span></>}
          </h1>
          {!invalid && <p className="text-sm text-muted-foreground">Set your name and password to accept.</p>}
        </div>

        <Card>
          <CardContent className="p-6">
            {invalid ? (
              <div className="flex flex-col gap-3 text-center">
                <p className="text-sm text-muted-foreground">This invite is invalid, already used, or expired.</p>
                <Link to="/login" className="text-sm text-primary hover:underline">Go to sign in</Link>
              </div>
            ) : info.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading invite…</p>
            ) : (
              <form
                onSubmit={(e: FormEvent) => { e.preventDefault(); accept.mutate({ token, name, password }); }}
                className="flex flex-col gap-3"
              >
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input value={info.data?.email ?? ""} disabled className={`${field} opacity-70`} />
                <label className="text-xs font-medium text-muted-foreground">Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={field} required />
                <label className="text-xs font-medium text-muted-foreground">Choose a password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={field} minLength={8} required />
                <Button type="submit" size="lg" disabled={accept.isPending} className="mt-1">
                  {accept.isPending ? "Joining…" : `Join as ${info.data?.role}`}
                </Button>
                {accept.error && <p className="text-sm text-destructive">{accept.error.message}</p>}
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
