# KubePilot — Phase 2 Recommendation Engine: Research & Design Defaults

**Version:** 1.0
**Status:** Research complete (deep-research, 2026-07-05; 23/25 claims adversarially verified)
**Companion to:** `02-Architecture.md` §3.5–3.6 (this grounds that design in industry practice + concrete numbers)

> **How to read this:** these are the **defensible defaults** to encode as deterministic TS rules.
> Every number here is either from a primary source (K8s docs, Karpenter, cluster-autoscaler FAQ,
> KRR repo) or a corroborated vendor rule-of-thumb (flagged). Tool defaults are configurable and
> version-dependent — pin them when hard-coding.

---

## 0. TL;DR — default numbers to encode

| Knob | Default | Source / confidence |
|---|---|---|
| **CPU request** | **p95** of observed usage | KRR `simple` (primary); VPA ~p90; ScaleOps p95/p99 — **high** |
| **CPU limit** | **do NOT introduce or tighten** (leave unset; may suggest removing an over-tight one) | KRR/ScaleOps/StormForge — **high** (K8s blog dissents for multi-tenant isolation) |
| **Memory request** | **MAX (peak) + 15% buffer**; **+25%** if an OOMKill occurred in window | KRR (`--memory_buffer_percentage` 15 / 25 on OOM) — **high** |
| **Memory limit** | **== memory request** (Guaranteed QoS) | K8s QoS docs + StormForge/ScaleOps + Tim Hockin — **high** |
| **Observation window** | **14 days** default (CPU tolerates less; memory/periodicity wants 14–30d) | KRR `--history_duration=336h` — **high** |
| **Headroom (general)** | **15–25%** default; widen toward **60%** for spiky/HA-critical | KRR 15% / VPA +15% (low end); Cast AI 20–60% — **medium** |
| **Node scale-down utilization threshold** | **50%** (requests/allocatable) | cluster-autoscaler `--scale-down-utilization-threshold=0.5` — **high** |
| **Node "unneeded" dwell** | **10 min** before removal | cluster-autoscaler `--scale-down-unneeded-time` — **high** |
| **Scheduling/packing buffer** | leave headroom; CA uses 50%, product-tunable toward **80–85%** packing | inferred from CA — **medium** |

**Our data already fits:** the agent stores **CPU p95** and **memory MAX** — exactly the inputs the industry uses. No collection changes needed for rightsizing.

---

## 1. CPU rightsizing
- **Request = p95** of observed CPU. CPU is *compressible* → bursting above the request is safe, so a high percentile (not max) is fine.
- **No CPU limit.** The Linux **CFS quota throttles** a container once it burns its per-100ms quota *even when the node has idle CPU* → tail-latency spikes, timeouts (worst for multithreaded apps). Measurable via `container_cpu_cfs_throttled_seconds_total`. Correctly-set requests already guarantee proportional CPU.
- **Safe framing for a recommend engine:** *never introduce or tighten* CPU limits; optionally suggest removing an existing over-tight limit. (Don't blanket-strip — the K8s blog notes limits aid multi-tenant isolation.)

## 2. Memory rightsizing (OOM-safe)
- **Request = MAX + 15% buffer** over the window. Memory is *non-compressible* → exceeding the limit = **OOMKill**. A mid percentile is unsafe (it undersizes true peaks).
- **OOMKill guardrail:** if an OOMKill occurred in the window, **raise, never lower**, and use a **25% buffer**. Lower confidence on recent restarts / high variance.
- **Memory limit == request → Guaranteed QoS.** Guaranteed pods are evicted *last* under node pressure and never evicted for another pod's overuse. An over-consuming pod OOMKills at its *own* limit rather than starving neighbors.
- Respect LimitRange floors.

## 3. HPA-on-CPU coupling (critical trap)
- HPA computes utilization% against `resources.requests.cpu`, **not** node capacity or actual usage. So **lowering a CPU request mechanically raises utilization%** → HPA scales replicas **up** → savings erased (or worse, a scaling death-spiral).
  - Worked example: 150m usage / 200m request = 75% (fine at 70% target). Lower request to 100m → 150% → `desiredReplicas` jumps 3→5.
- **Safe handling (in order of preference):**
  1. **Exclude HPA-managed workloads from request recs by default** (KRR does exactly this — `--allow-hpa=FALSE`). Simplest v1.
  2. Or **re-target** the HPA `averageUtilization` proportionally when lowering the request.
  3. Or **re-simulate** the post-change replica count and fold it into savings before claiming any.
  - Never treat CPU-request savings as free under an active CPU-metric HPA.

## 4. Autoscaler decision matrix
| Managed by | Request rec | Replica rec | Notes |
|---|---|---|---|
| **Bare Deployment** | ✅ rightsize | ✅ lower replicas if sustained low util | static capacity |
| **HPA (CPU/mem metric)** | ⛔ skip by default (or re-target/re-simulate) | ⛔ no fixed replicas → ✅ may lower `minReplicas` | HPA owns replicas; coupling trap |
| **VPA Auto / Recreate** | ⛔ skip (VPA owns requests) | ✅ | don't fight VPA |
| **VPA Off / Initial** | ✅ rightsize | ✅ | VPA only recommends / sets-at-create |
| **KEDA** | ✅ rightsize | ⛔ skip (external-metric driven) | treat like HPA for the coupled metric |
| **DaemonSet** | ✅ rightsize (× node count) | ⛔ n/a | per-node overhead |
| **CronJob / Job** | ✅ size from per-run peak | ⛔ not "idle" | idle 23h/day ≠ waste |

> **Gap:** the confirmed research didn't nail VPA updateMode specifics or KEDA gating beyond the coupling point — the matrix rows for those are from our architecture doc + inference; validate against VPA/KEDA docs when implementing.

## 5. Replica / scale-down optimization
- Require **sustained, peak-aware** low utilization (don't cut below weekly/monthly peaks).
- **Respect PDB minimums** — never recommend replicas below what the PDB requires available.

## 6. Node-level savings via bin-packing (the real dollars)
- **`request − usage` is NOT money saved.** You pay for **nodes**; a dollar is saved only when a **whole node is removed**. Report two distinct numbers: **waste/efficiency gap** (informational) vs **realized savings** (node removal).
- **Prove drainability by a scheduling simulation** (Karpenter/CA style): a node is removable only if **all its pods reschedule** onto other nodes' free capacity (respecting every constraint), or replaced by a strictly **lower-priced** node.
- **Feasibility / drainability blockers checklist** (any → node NOT removable, surface "blocked by …"):
  - a **restrictive PDB** (⚠️ a *single* blocking PDB blocks the *whole* node — all PDBs on the node must allow disruption)
  - pod annotated `cluster-autoscaler.kubernetes.io/safe-to-evict=false`
  - pods **not backed by a controller** (bare pods)
  - **kube-system** pods without a PDB
  - pods using **local storage**
  - plus the scheduling constraints (nodeSelector/affinity/anti-affinity, taints/tolerations, topology spread, PVC node-affinity, DaemonSet per-node overhead, GPU) — part of the fit simulation
- Algorithm: **First-Fit-Decreasing** with per-node DaemonSet reservation, pack against **allocatable** (capacity − kube/system-reserved), leave the scheduling buffer.
- **Realization:** Karpenter/CA auto-realize (Karpenter re-provisions cheaper); **no autoscaler → "requires manual node-pool resize," lower confidence.** Karpenter only replaces a node when the replacement is strictly cheaper.

## 7. Cost / pricing
- Use **effective pricing** (spot/preemptible, Savings Plans/CUD/RIs, negotiated discounts), not list price; label estimates clearly.
- Realized savings = `baseline_node_cost − simulated_node_cost` at effective rates.
- > **Gap:** the SP/CUD/RI-vs-list pricing detail wasn't established by primary sources — needs its own sourcing in the Cost phase (Phase 3).

## 8. Confidence score — inputs
Confidence is a function of: **data sufficiency** (window vs required), **variance/periodicity**, **stability history** (recent OOMKills/restarts lower *memory* confidence), **headroom margin** (distance from observed peak), and **autoscaler realizability** (auto via CA/Karpenter vs requires-manual). *(No single authoritative formula surfaced — define our own from these inputs.)*

## 9. Data-sufficiency gating
- **14 days** is the concrete industry default (KRR). CPU (fast signal) tolerates less; **memory & periodicity** want the longer end (up to 30d) to capture true peaks and daily/weekly cycles.
- Mark early recs **preliminary / low-confidence** rather than withholding. *(Exact cold-start thresholds weren't authoritatively established — gap.)*

## 10. GitOps-aware patch output
- **Imperative `kubectl patch/edit/scale` gets reverted** by ArgoCD/Flux auto-sync + self-heal within the reconcile interval (breaks Git-as-source-of-truth).
- For GitOps workloads emit a **PR against the source manifests** (Helm values / Kustomize), not an imperative patch. Requires a **manifest-rendering step** to map a rendered-object change back to the correct source template/values file.
- **Re-validate/re-render** each patch against the latest source state before opening the PR.

---

## ⛔ Refuted — do NOT use these (they sounded plausible but failed verification)
- KRR does **NOT** default CPU to **p99** — it's **p95**.
- Cast AI does **NOT** recommend **p99** for CPU requests/limits.

## Gaps needing dedicated sourcing before implementing those pieces
VPA updateMode Off/Initial/Auto/Recreate gating specifics · KEDA-specific handling · GPU/topology-spread/PVC-affinity feasibility details · Savings Plans/CUD/RI vs list pricing · concrete cold-start data-sufficiency thresholds · a concrete confidence-score formula.

## Primary sources
- KRR (Robusta) — github.com/robusta-dev/krr · docs.robusta.dev/master/configuration/resource-recommender.html
- Karpenter disruption — karpenter.sh/docs/concepts/disruption/
- cluster-autoscaler FAQ — github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md
- Kubernetes HPA + Pod QoS docs — kubernetes.io
- AWS Containers: right-sizing with GitOps — aws.amazon.com/blogs/containers/kubernetes-right-sizing-with-metrics-driven-gitops-automation/
- (corroborating blogs: ScaleOps, StormForge, Sealos, Cast AI)
