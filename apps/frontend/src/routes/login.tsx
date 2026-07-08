import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Gauge } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

export function LoginPage() {
  const [email, setEmail] = useState("owner@acme.test");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/app");
    },
  });

  // Already signed in → straight to the app.
  if (!isLoading && user) return <Navigate to="/app" replace />;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Ambient glow */}
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
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome to <span className="text-gradient">KubePilot</span>
            </h1>
            <p className="text-sm text-muted-foreground">Sign in to your FinOps dashboard.</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); login.mutate({ email, password }); }} className="flex flex-col gap-3">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                required
              />
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10 rounded-lg border border-border bg-background/60 px-3 text-sm transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                required
              />
              <Button type="submit" size="lg" disabled={login.isPending} className="mt-1">
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
              {login.error && <p className="text-sm text-destructive">{login.error.message}</p>}
              <p className="mt-2 text-center text-sm text-muted-foreground">
                New company? <Link to="/register" className="text-primary hover:underline">Register</Link>
              </p>
              <p className="text-center text-xs text-muted-foreground">Dev: owner@acme.test / demo1234</p>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
