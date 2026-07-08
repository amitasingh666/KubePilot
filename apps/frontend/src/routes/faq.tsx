import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Card } from "../components/ui/card";
import { cn } from "../lib/utils";

const FAQS: { q: string; a: string }[] = [
  { q: "Does KubePilot change my cluster?", a: "No. It's strictly recommend-only in v1 — the agent has read-only RBAC and KubePilot never writes to your cluster. You review each recommendation and apply the provided patch yourself (GitOps PR or kubectl)." },
  { q: "Is my data safe? What does the agent collect?", a: "The agent collects metrics and metadata only — resource usage, requests/limits, node/workload topology, autoscalers. It strips secrets, env values, and non-allowlisted annotations before anything leaves your cluster, and connects outbound-only over a secure channel (no inbound ports opened)." },
  { q: "Do I need Prometheus?", a: "Yes — KubePilot reuses your existing Prometheus for usage metrics (CPU p95, memory MAX). The onboarding flow includes a compatibility check. It reads Prometheus; it does not replace it." },
  { q: "Which clouds are supported?", a: "The cost engine is provider-agnostic by design. v1 ships with an AWS pricing catalog; GCP and Azure are additional price data with no code changes. Effective/real-billing import (AWS CUR, GCP/Azure exports) is on the roadmap." },
  { q: "How does it avoid recommending something dangerous?", a: "Memory is sized to the observed peak (never a percentile) with an OOMKill guardrail; CPU limits are never tightened; replica and node-drain suggestions respect PodDisruptionBudgets and only fire when consolidation is provably feasible. Everything is advisory with a confidence score." },
  { q: "Can I self-host it?", a: "Yes — KubePilot is fully open source. Run the whole stack yourself (Postgres/TimescaleDB, Redis, object storage, the services and agent chart), or use a hosted company account. See the Docs to get started." },
  { q: "How is multi-tenancy handled?", a: "Each company is a tenant; every query is scoped to your tenant at the application layer, agent tokens are per-cluster and rotatable, and security-sensitive actions are audit-logged. Row-level security is a documented production-hardening step." },
  { q: "How much can it save?", a: "Typical unoptimized clusters carry 30–35% waste. KubePilot surfaces the specific, safe reductions and reports realized vs waste savings separately so the numbers are defensible — not request-delta fiction." },
];

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 p-5 text-left">
        <span className="font-medium">{q}</span>
        <ChevronDown size={18} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden"
      >
        <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>
      </motion.div>
    </Card>
  );
}

export function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Frequently asked questions</h1>
        <p className="mt-3 text-lg text-muted-foreground">Everything about safety, data, clouds, and self-hosting.</p>
      </div>
      <div className="mt-10 flex flex-col gap-3">
        {FAQS.map((f) => <Item key={f.q} {...f} />)}
      </div>
    </div>
  );
}
