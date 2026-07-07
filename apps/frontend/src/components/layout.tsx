import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutDashboard, Server, Lightbulb, FileText, LogOut, Gauge } from "lucide-react";
import { trpc } from "../lib/trpc";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "./ui/theme-toggle";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/clusters", label: "Clusters", icon: Server, end: false },
  { to: "/recommendations", label: "Recommendations", icon: Lightbulb, end: false },
  { to: "/reports", label: "Reports", icon: FileText, end: false },
];

export function AppLayout() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/login");
    },
  });

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="glass sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.6)]">
            <Gauge size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">KubePilot</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => {
            const active = end ? location.pathname === to : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon size={16} className="relative z-10" />
                <span className="relative z-10">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="m-3 rounded-xl border border-border bg-elevated/50 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium capitalize">{user?.role ?? "—"}</div>
              <div className="truncate text-xs text-muted-foreground">tenant {user?.tenantId?.slice(0, 8)}…</div>
            </div>
            <ThemeToggle />
          </div>
          <button
            onClick={() => logout.mutate()}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="scroll-slim flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
