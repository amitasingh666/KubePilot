import { trpc } from "../lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export function OverviewPage() {
  const profile = trpc.auth.profile.useQuery();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Cost & utilization summary lands here in Stage F.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
          <CardDescription>Confirms the API, auth, and tenant scoping are wired end-to-end.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {profile.data ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
              <dt className="text-muted-foreground">User</dt>
              <dd>{profile.data.name ?? profile.data.email}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{profile.data.role}</dd>
              <dt className="text-muted-foreground">Tenant</dt>
              <dd>{profile.data.tenantName}</dd>
            </dl>
          ) : (
            <span className="text-muted-foreground">Loading…</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
