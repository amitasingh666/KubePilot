import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Server, Lightbulb, LogOut } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/clusters", label: "Clusters", icon: Server, end: false },
  { to: "/recommendations", label: "Recommendations", icon: Lightbulb, end: false },
];

export function AppLayout() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/login");
    },
  });

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="px-5 py-4 text-lg font-bold tracking-tight">KubePilot</div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          <div className="px-2 pb-2">
            <div className="font-medium text-foreground">{user?.role}</div>
            <div>tenant: {user?.tenantId?.slice(0, 8)}…</div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => logout.mutate()}>
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
