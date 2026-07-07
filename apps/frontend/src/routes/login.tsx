import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export function LoginPage() {
  const [email, setEmail] = useState("owner@acme.test");
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate(); // refetch session → RequireAuth lets us in
      navigate("/");
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email });
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Sign in to KubePilot</CardTitle>
          <CardDescription>Dev login — use a seeded user (e.g. owner@acme.test).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
            {login.error && (
              <p className="text-sm text-destructive">{login.error.message}</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
