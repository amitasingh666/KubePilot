import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Star, ShieldCheck, Gauge, Boxes, GitBranch, DollarSign, Cpu, Sparkles, TerminalSquare,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { GITHUB_URL } from "../components/public-layout";
import { buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { CopyButton } from "../components/ui/copy-button";
import { cn } from "../lib/utils";

const FEATURES = [
  { icon: ShieldCheck, title: "Read-only agent", body: "A lightweight Helm agent reads Prometheus + the K8s API. Outbound-only, no inbound ports, never touches your app data." },
  { icon: Sparkles, title: "Safe recommendations", body: "CPU/memory rightsizing, replica & idle-node cuts — always recommend-only, with a copy-paste patch. Never OOM-risky." },
  { icon: DollarSign, title: "Node-level cost", body: "Real dollars from effective pricing. Waste vs realized savings shown distinctly — no request-delta fiction." },
  { icon: Cpu, title: "Autoscaler-aware", body: "Understands HPA/VPA/KEDA and Karpenter/CA so it never fights your autoscalers or double-counts savings." },
  { icon: GitBranch, title: "GitOps-ready patches", body: "PR-ready YAML for Argo/Flux, or imperative kubectl — validated against your latest cluster state." },
  { icon: Boxes, title: "Multi-tenant & secure", body: "Per-tenant isolation, rotatable agent tokens, audit logging. Built to run for many clusters and teams." },
];

const STEPS = [
  { n: 1, title: "Install the agent", body: "One helm install in your cluster. It connects outbound over a secure channel." },
  { n: 2, title: "Collect metrics", body: "The agent summarizes CPU p95 / memory MAX + topology and pushes to KubePilot." },
  { n: 3, title: "Analyze", body: "The engine finds waste, simulates bin-packing, and prices it — safely, per tenant." },
  { n: 4, title: "See savings", body: "Ranked recommendations with dollars, confidence, and ready-to-apply patches." },
];

const STATS = [
  { value: "30–35%", label: "typical cluster waste" },
  { value: "< 30 min", label: "to first recommendation" },
  { value: "≥ 90%", label: "accuracy target" },
  { value: "100%", label: "recommend-only & open source" },
];

const reveal = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

export function LandingPage() {
  const { user } = useAuth();
  const primaryCta = user ? { to: "/app", label: "Go to dashboard" } : { to: "/register", label: "Get started free" };

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px]" />
        <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
          <motion.div initial="hidden" animate="show" variants={reveal}>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Open-source Kubernetes FinOps
            </span>
          </motion.div>
          <motion.h1
            initial="hidden" animate="show" variants={reveal} transition={{ delay: 0.05 }}
            className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl"
          >
            Cut your Kubernetes bill<br />
            <span className="text-gradient">without the guesswork.</span>
          </motion.h1>
          <motion.p
            initial="hidden" animate="show" variants={reveal} transition={{ delay: 0.1 }}
            className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground"
          >
            KubePilot analyzes real usage and tells you exactly what to right-size — and how much
            it saves — with safe, copy-paste patches. Where Grafana shows what's happening,
            KubePilot tells you what to do about it.
          </motion.p>
          <motion.div
            initial="hidden" animate="show" variants={reveal} transition={{ delay: 0.15 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to={primaryCta.to} className={cn(buttonVariants({ size: "lg" }), "group")}>
              {primaryCta.label} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}>
              <Star size={16} /> Star on GitHub
            </a>
          </motion.div>
        </div>

        {/* Stats bar */}
        <div className="mx-auto max-w-4xl px-6 pb-16">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STATS.map((s, i) => (
              <motion.div key={s.label} initial="hidden" whileInView="show" viewport={{ once: true }} variants={reveal} transition={{ delay: i * 0.05 }}>
                <Card className="p-4 text-center">
                  <div className="text-xl font-bold text-gradient">{s.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Everything you need to stop overpaying</h2>
          <p className="mt-3 text-muted-foreground">Safe by design, defensible in dollars, and built for real multi-cluster fleets.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial="hidden" whileInView="show" viewport={{ once: true }} variants={reveal} transition={{ delay: (i % 3) * 0.05 }}>
              <Card className="h-full p-6 hover:-translate-y-1 hover:shadow-glow">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><f.icon size={20} /></span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">From install to savings in minutes</h2>
            <p className="mt-3 text-muted-foreground">Four steps, fully non-destructive — KubePilot never changes your cluster.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.div key={s.n} initial="hidden" whileInView="show" viewport={{ once: true }} variants={reveal} transition={{ delay: i * 0.08 }} className="relative">
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-gradient-primary text-sm font-bold text-primary-foreground">{s.n}</div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </motion.div>
            ))}
          </div>

          {/* Install snippet */}
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={reveal} className="mx-auto mt-12 max-w-2xl">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground"><TerminalSquare size={14} /> install the agent</span>
                <CopyButton text={"helm repo add kubepilot https://charts.kubepilot.dev\nhelm install kubepilot-agent kubepilot/agent \\\n  --set clusterId=<id> --set token=<token>"} />
              </div>
              <pre className="scroll-slim overflow-x-auto p-4 text-xs leading-relaxed">{`helm repo add kubepilot https://charts.kubepilot.dev
helm install kubepilot-agent kubepilot/agent \\
  --set clusterId=<id> --set token=<token>`}</pre>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Open-source CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={reveal}>
          <Card className="relative overflow-hidden p-10 text-center sm:p-16">
            <div className="pointer-events-none absolute inset-0 bg-gradient-primary opacity-[0.07]" />
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight">Open source. Self-host or use the cloud.</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                KubePilot is fully open source — run it yourself, or spin up a free company account and connect your first cluster in minutes.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to={primaryCta.to} className={buttonVariants({ size: "lg" })}>{primaryCta.label}</Link>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}>
                  <Star size={16} /> View source
                </a>
              </div>
            </div>
          </Card>
        </motion.div>
      </section>
    </div>
  );
}
