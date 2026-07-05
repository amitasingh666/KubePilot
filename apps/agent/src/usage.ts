import { KubeConfig, CoreV1Api, AppsV1Api, BatchV1Api } from "@kubernetes/client-node";
import { Snapshot, serializeIdempotencyKey } from "@kubepilot/contract";
import type { WorkloadUsage, WorkloadKind } from "@kubepilot/contract";
import {
  probeMetricCompatibility,
  queryPodCpuP95,
  queryPodMemMax,
  USAGE_WINDOW,
  USAGE_WINDOW_SEC,
} from "./prometheus.js";

/**
 * Stage G — Agent Prometheus usage.
 *
 * The agent runs in the CUSTOMER's cluster, so we never depend on components we
 * can't guarantee (e.g. kube-state-metrics). Usage NUMBERS come from cAdvisor via
 * PromQL (prometheus.ts); pod→workload ATTRIBUTION comes from the read-only
 * Kubernetes API — the one thing the agent is always granted. We then summarize
 * to WORKLOAD level in-process (avoiding pod-cardinality blowup) and emit a
 * contract-valid `usage` snapshot.
 */

type WorkloadRef = { namespace: string; workload: string; kind: WorkloadKind };
type PodOwner = { ref: WorkloadRef; restarts: number };

/**
 * Build "namespace/pod" → owning workload, resolving the Kubernetes ownership
 * chain via the API:
 *   Pod → ReplicaSet → Deployment   (the common case; 2 hops)
 *   Pod → StatefulSet | DaemonSet   (pod owns these directly; 1 hop)
 *   Pod → Job → CronJob             (scheduled jobs)
 * Bare pods (no controller) and unknown owner kinds are skipped — they aren't
 * workloads we track. Restart counts also come from here, not from KSM.
 */
export async function buildPodOwnership(kc: KubeConfig): Promise<Map<string, PodOwner>> {
  const core = kc.makeApiClient(CoreV1Api);
  const apps = kc.makeApiClient(AppsV1Api);
  const batch = kc.makeApiClient(BatchV1Api);

  const [pods, replicaSets, jobs] = await Promise.all([
    core.listPodForAllNamespaces(),
    apps.listReplicaSetForAllNamespaces(),
    batch.listJobForAllNamespaces(),
  ]);

  // "namespace/replicaset" → owning Deployment name (hop 2).
  const rsToDeployment = new Map<string, string>();
  for (const rs of replicaSets.items) {
    const owner = rs.metadata?.ownerReferences?.find((o) => o.kind === "Deployment");
    if (owner) rsToDeployment.set(`${rs.metadata?.namespace}/${rs.metadata?.name}`, owner.name);
  }

  // "namespace/job" → owning CronJob name.
  const jobToCronJob = new Map<string, string>();
  for (const j of jobs.items) {
    const owner = j.metadata?.ownerReferences?.find((o) => o.kind === "CronJob");
    if (owner) jobToCronJob.set(`${j.metadata?.namespace}/${j.metadata?.name}`, owner.name);
  }

  const map = new Map<string, PodOwner>();
  for (const p of pods.items) {
    const ns = p.metadata?.namespace ?? "";
    const podName = p.metadata?.name ?? "";
    const owner = p.metadata?.ownerReferences?.[0];
    if (!ns || !podName || !owner) continue; // bare pod → not tracked

    let ref: WorkloadRef | undefined;
    switch (owner.kind) {
      case "ReplicaSet": {
        const deployment = rsToDeployment.get(`${ns}/${owner.name}`);
        ref = deployment
          ? { namespace: ns, workload: deployment, kind: "deployment" }
          : { namespace: ns, workload: owner.name, kind: "replicaset" }; // bare RS
        break;
      }
      case "StatefulSet":
        ref = { namespace: ns, workload: owner.name, kind: "statefulset" };
        break;
      case "DaemonSet":
        ref = { namespace: ns, workload: owner.name, kind: "daemonset" };
        break;
      case "Job": {
        const cron = jobToCronJob.get(`${ns}/${owner.name}`);
        ref = cron
          ? { namespace: ns, workload: cron, kind: "cronjob" }
          : { namespace: ns, workload: owner.name, kind: "job" };
        break;
      }
      default:
        continue; // unknown controller kind
    }

    const restarts = (p.status?.containerStatuses ?? []).reduce(
      (sum, cs) => sum + (cs.restartCount ?? 0),
      0,
    );
    map.set(`${ns}/${podName}`, { ref, restarts });
  }
  return map;
}

/**
 * Collect workload-level usage and assemble a contract-valid `usage` Snapshot.
 * Cross-replica aggregation is intentionally conservative — we take the MAX
 * across a workload's live replicas (busiest replica) so the downstream
 * rightsizing rule never sizes a replica below what one of them actually needs.
 */
export async function collectUsageSnapshot(
  kc: KubeConfig,
  clusterId: string,
  agentVersion: string,
): Promise<Snapshot> {
  // Task ④ — fail loud with a clear onboarding signal if the required series
  // aren't present, rather than silently emitting empty usage.
  const probe = await probeMetricCompatibility();
  if (!probe.ok) {
    throw new Error(
      `Prometheus is missing required cAdvisor series ` +
        `(cpu=${probe.cpu}, memory=${probe.memory}). Usage collection cannot proceed.`,
    );
  }

  const [owners, cpuByPod, memByPod] = await Promise.all([
    buildPodOwnership(kc),
    queryPodCpuP95(),
    queryPodMemMax(),
  ]);

  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - USAGE_WINDOW_SEC * 1000).toISOString();

  // Aggregate per-pod metrics up to workload level.
  const byWorkload = new Map<string, WorkloadUsage>();
  for (const [podKey, { ref, restarts }] of owners) {
    const cpu = cpuByPod.get(podKey) ?? 0;
    const mem = memByPod.get(podKey) ?? 0;

    const wlKey = `${ref.namespace}/${ref.kind}/${ref.workload}`;
    const existing = byWorkload.get(wlKey);
    if (existing) {
      existing.cpuP95Millicores = Math.max(existing.cpuP95Millicores, cpu);
      existing.memMaxBytes = Math.max(existing.memMaxBytes, mem);
      existing.restarts += restarts;
    } else {
      byWorkload.set(wlKey, {
        namespace: ref.namespace,
        workload: ref.workload,
        kind: ref.kind,
        windowStart,
        windowEnd,
        windowSec: USAGE_WINDOW_SEC,
        cpuP95Millicores: cpu,
        memMaxBytes: mem,
        restarts,
      });
    }
  }

  // Drop workloads Prometheus had no data for (memory working set is ~always
  // non-zero for a live container, so 0 means "no samples mapped").
  const workloads = [...byWorkload.values()].filter((w) => w.memMaxBytes > 0);

  const snapshot: Snapshot = {
    contractVersion: "2.0",
    agentVersion,
    clusterId,
    capturedAt: windowEnd,
    idempotencyKey: serializeIdempotencyKey({
      clusterId,
      target: "usage",
      windowStart,
      windowEnd,
      agentVersion,
    }),
    payloadKind: "usage",
    gitopsController: "none",
    usage: { workloads, nodes: [] }, // node usage deferred — needs node-exporter (not guaranteed in a customer cluster) and is out of Stage G scope
  };

  return Snapshot.parse(snapshot);
}
