import { motion } from "framer-motion";
import { CopyButton } from "../components/ui/copy-button";

const reveal = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
};

const SECTIONS = [
  { id: "what", label: "What it is" },
  { id: "how", label: "How it works" },
  { id: "install", label: "Install the agent" },
  { id: "recommendations", label: "Recommendations" },
  { id: "cost", label: "Cost model" },
  { id: "security", label: "Security & isolation" },
  { id: "feedback", label: "Feedback loop" },
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 text-2xl font-bold tracking-tight">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed text-muted-foreground">{children}</p>;
}

export function DocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <motion.div initial="hidden" animate="show" variants={reveal}>
        <h1 className="text-4xl font-bold tracking-tight">Documentation</h1>
        <p className="mt-3 text-lg text-muted-foreground">How KubePilot works, end to end.</p>
      </motion.div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[200px_1fr]">
        {/* TOC */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-1 text-sm">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{s.label}</a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <article className="flex flex-col gap-14">
          <section>
            <H id="what">What it is</H>
            <P>
              KubePilot is an open-source FinOps platform for Kubernetes. It continuously analyzes real
              resource usage and produces <strong>actionable, cost-saving recommendations</strong> with the
              dollars attached — and generates copy-paste patches you apply yourself. It is
              <strong> recommend-only</strong>: it never changes your cluster.
            </P>
          </section>

          <section>
            <H id="how">How it works</H>
            <P>Four stages, agent → ingestion → analysis → dashboard:</P>
            <ol className="mt-4 flex flex-col gap-3">
              {[
                ["1. Agent", "A lightweight, read-only Helm agent runs in your cluster. It reads your existing Prometheus (CPU p95, memory MAX) plus the Kubernetes API (workloads, nodes, autoscalers, PDBs) and pushes summarized data outbound over a secure channel — no inbound ports."],
                ["2. Ingestion", "A token-authenticated API validates and enqueues each snapshot; workers dedupe by idempotency key and write to Postgres + TimescaleDB."],
                ["3. Analysis", "A per-tenant engine runs rules (CPU/memory rightsizing, replica & idle-node cuts, cleanup), simulates bin-packing, and attaches effective-pricing dollars."],
                ["4. Dashboard", "You see ranked recommendations, cost, and utilization — and copy the patch to apply."],
              ].map(([t, b]) => (
                <li key={t} className="rounded-lg border border-border bg-card/50 p-4">
                  <div className="font-semibold">{t}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{b}</div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <H id="install">Install the agent</H>
            <P>Create a cluster connection in the dashboard to get your token, then:</P>
            <div className="mt-4 rounded-lg border border-border bg-card/50">
              <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
                <span>helm</span>
                <CopyButton text={"helm repo add kubepilot https://charts.kubepilot.dev\nhelm install kubepilot-agent kubepilot/agent \\\n  --namespace kubepilot --create-namespace \\\n  --set clusterId=<id> --set token=<token>"} />
              </div>
              <pre className="scroll-slim overflow-x-auto p-4 text-xs leading-relaxed">{`helm repo add kubepilot https://charts.kubepilot.dev
helm install kubepilot-agent kubepilot/agent \\
  --namespace kubepilot --create-namespace \\
  --set clusterId=<id> --set token=<token>`}</pre>
            </div>
            <P>The agent uses a read-only RBAC ServiceAccount and strips secrets/env before egress. Data appears in the dashboard within minutes.</P>
          </section>

          <section>
            <H id="recommendations">Recommendations</H>
            <P>
              Rules are deterministic and conservative: CPU rightsizing uses p95 + headroom (never tightens CPU limits);
              memory uses the observed peak (MAX, never a percentile) with an OOMKill guardrail; replica and idle-node
              cuts respect PDBs and only fire on provably-safe consolidation. Every recommendation carries a
              confidence score and a ready-to-apply patch (GitOps PR or kubectl).
            </P>
          </section>

          <section>
            <H id="cost">Cost model</H>
            <P>
              Cost is node-based, from an effective-pricing catalog (list price now, real billing import later). Savings
              are split into two figures that are <strong>never summed</strong>: <em>realized</em> (nodes/volumes actually
              freed by the reconciled plan) and <em>waste</em> (the value of freed requests, which isn't money until a
              node is removed). Utilization shows requested vs used so over-provisioning is obvious.
            </P>
          </section>

          <section>
            <H id="security">Security & isolation</H>
            <P>
              Outbound-only agent; per-cluster rotatable tokens (stored hashed); PodSpec secret stripping. The platform is
              multi-tenant with application-layer isolation — every query is scoped to your tenant — plus audit logging of
              security-sensitive actions. Encryption in transit; encryption at rest via your managed stores.
            </P>
          </section>

          <section>
            <H id="feedback">Feedback loop</H>
            <P>
              KubePilot measures its own accuracy: it diffs workload revision history to detect which optimizations were
              applied, then checks whether they stayed safe (e.g. no OOMKill after a memory cut). That produces a
              recommendation-accuracy score you can hold it to.
            </P>
          </section>
        </article>
      </div>
    </div>
  );
}
