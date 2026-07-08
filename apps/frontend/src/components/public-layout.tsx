import { Link, NavLink, Outlet } from "react-router-dom";
import { Gauge, Star } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "./ui/theme-toggle";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

const GITHUB_URL = "https://github.com/kubepilot/kubepilot";

function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="glass sticky top-0 z-50 border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.6)]">
            <Gauge size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">KubePilot</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {[
            { to: "/docs", label: "Docs" },
            { to: "/faq", label: "FAQ" },
          ].map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn("rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? "text-primary" : "text-muted-foreground hover:text-foreground")
              }
            >
              {l.label}
            </NavLink>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <span className="inline-flex items-center gap-1.5"><Star size={15} /> GitHub</span>
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Link to="/app" className={buttonVariants({ size: "sm" })}>Dashboard</Link>
          ) : (
            <>
              <Link to="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>Sign in</Link>
              <Link to="/register" className={buttonVariants({ size: "sm" })}>Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-primary" />
          <span>KubePilot — open-source Kubernetes FinOps</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/docs" className="hover:text-foreground">Docs</Link>
          <Link to="/faq" className="hover:text-foreground">FAQ</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
          <Link to="/register" className="hover:text-foreground">Get started</Link>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}

export { GITHUB_URL };
