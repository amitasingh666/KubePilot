import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { trpc } from "./trpc";

/** Current session (null = anonymous), plus a loading flag for the initial check. */
export function useAuth() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  return { user: me.data ?? null, isLoading: me.isLoading };
}

/** Gate a subtree behind login: redirect anonymous users to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
