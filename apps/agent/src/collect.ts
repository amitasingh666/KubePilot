import { KubeConfig, CoreV1Api, AppsV1Api, AutoscalingV2Api, PolicyV1Api } from "@kubernetes/client-node";
import type { V1Node, V1Deployment, V1DaemonSet, V1StatefulSet, V1Container, V2HorizontalPodAutoscaler,
    V1PersistentVolumeClaim, V1Service, V1PodDisruptionBudget, V1PodSpec, V1ObjectMeta } from "@kubernetes/client-node";
import { Snapshot, serializeIdempotencyKey } from "@kubepilot/contract";
import type { NodeInventory, WorkloadInventory, ResourceQuantities, AutoscalerInventory,
     WorkloadKind, PvcInventory, ServiceInventory, PdbInventory, SchedulingConstraint } from "@kubepilot/contract";

// --- Kubernetes quantity parsers -------------------------------------------
// CPU: "8" = 8 cores = 8000m; "500m" = 500; "0.5" = 500
export function cpuToMillicores(q?: string): number | undefined {
  if (!q) return undefined;
  if (q.endsWith("m")) return parseInt(q.slice(0, -1), 10);
  return Math.round(parseFloat(q) * 1000);
}

// Memory: suffixes are binary (Ki/Mi/Gi/Ti) or decimal (K/M/G/T), or plain bytes.
const MEM_UNITS: Record<string, number> = {
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
  K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
};
export function memToBytes(q?: string): number | undefined {
  if (!q) return undefined;
  const m = q.match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return undefined;
  const value = parseFloat(m[1]!);
  const unit = m[2];
  if (!unit) return Math.round(value);
  const mult = MEM_UNITS[unit];
  return mult ? Math.round(value * mult) : Math.round(value);
}

// --- map a V1Node → our contract's NodeInventory ---------------------------
export function toNodeInventory(n: V1Node): NodeInventory {
  const cap = n.status?.capacity ?? {};
  const alloc = n.status?.allocatable ?? {};
  const ready = n.status?.conditions?.find((c) => c.type === "Ready")?.status === "True";
  const labels = n.metadata?.labels ?? {};
  return {
    name: n.metadata?.name ?? "",
    nodeGroup: labels["eks.amazonaws.com/nodegroup"] ?? null,
    instanceType: labels["node.kubernetes.io/instance-type"] ?? null,
    capacityProvider: null,
    cpuCapacityMillicores: cpuToMillicores(cap.cpu) ?? null,
    memCapacityBytes: memToBytes(cap.memory) ?? null,
    cpuAllocatableMillicores: cpuToMillicores(alloc.cpu) ?? null,
    memAllocatableBytes: memToBytes(alloc.memory) ?? null,
    taints: (n.spec?.taints ?? []) as unknown as Record<string, unknown>[],
    labels,
    status: ready ? "ready" : "notready",
  };
}

export async function collectNodes(core: CoreV1Api): Promise<NodeInventory[]> {
  const res = await core.listNode();
  return res.items.map(toNodeInventory);
}


// One container's requests/limits
function containerResources(c: V1Container): ResourceQuantities {
    const req = c.resources?.requests ?? {};
    const lim = c.resources?.limits ?? {};
    return {
      cpuRequestMillicores: cpuToMillicores(req.cpu) ?? null,
      cpuLimitMillicores: cpuToMillicores(lim.cpu) ?? null,
      memRequestBytes: memToBytes(req.memory) ?? null,
      memLimitBytes: memToBytes(lim.memory) ?? null,
    };
}

function sumField(specs: ResourceQuantities[], pick: (r: ResourceQuantities) => number | null | undefined): number | null {
    let total = 0, any = false;
    for (const r of specs) { const v = pick(r); if (v != null) { total += v; any = true; } }
    return any ? total : null;
}

// Scheduling facts from a pod template → contract SchedulingConstraint (or null
// if the workload has no placement rules). Used later for bin-packing feasibility.
function toSchedulingConstraint(spec?: V1PodSpec): SchedulingConstraint | null {
    if (!spec) return null;
    const hasAny =
        spec.nodeSelector ||
        spec.affinity ||
        (spec.tolerations?.length ?? 0) > 0 ||
        (spec.topologySpreadConstraints?.length ?? 0) > 0;
    if (!hasAny) return null;
    return {
        nodeSelector: spec.nodeSelector ?? null,
        affinity: (spec.affinity ?? null) as unknown as Record<string, unknown> | null,
        antiAffinity: (spec.affinity?.podAntiAffinity ?? null) as unknown as Record<string, unknown> | null,
        tolerations: (spec.tolerations ?? null) as unknown as Record<string, unknown>[] | null,
        topologySpread: (spec.topologySpreadConstraints ?? null) as unknown as Record<string, unknown>[] | null,
        pvcAffinity: null,
    };
}


// Generic mapper for any pod-templated workload (Deployment / DaemonSet /
// StatefulSet). They all expose metadata + spec.template.spec; only `kind` and
// where `replicas` comes from differ, so the caller passes those in.
export function toWorkload(
    meta: V1ObjectMeta | undefined,
    template: { metadata?: V1ObjectMeta; spec?: V1PodSpec } | undefined,
    kind: WorkloadKind,
    replicas: number | null,
    managedByMap: Map<string, string>,
): WorkloadInventory {
    const podSpec = template?.spec;
    const containers = podSpec?.containers ?? [];
    // Build the per-container specs once, then reuse for both the container list
    // and the workload-level aggregate.
    const specs = containers.map((c) => ({ name: c.name, resources: containerResources(c) }));
    const rq = specs.map((s) => s.resources);
    const namespace = meta?.namespace ?? "";
    const name = meta?.name ?? "";
    const key = `${namespace}/${kind}/${name}`; // uses the real kind so non-Deployment autoscalers match too
    return {
        name,
        namespace,
        kind,
        labels: meta?.labels ?? {},
        // Pod-template labels — what PDBs and Services select on (differs from the workload's own labels).
        podLabels: template?.metadata?.labels ?? {},
        replicas,
        containers: specs,
        managedBy: managedByMap.get(key) ?? "none",
        gitopsOwned: false,
        qosClass: null,
        constraints: toSchedulingConstraint(podSpec),
        resources: {
            cpuRequestMillicores: sumField(rq, (r) => r.cpuRequestMillicores),
            cpuLimitMillicores: sumField(rq, (r) => r.cpuLimitMillicores),
            memRequestBytes: sumField(rq, (r) => r.memRequestBytes),
            memLimitBytes: sumField(rq, (r) => r.memLimitBytes),
        },
    };
}

export async function collectWorkloads(apps: AppsV1Api,  managedByMap: Map<string, string> ): Promise<WorkloadInventory[]> {
    // Collect all three pod-templated kinds so their usage isn't dropped downstream.
    // (A DaemonSet has no spec.replicas — its "replica count" is how many nodes it
    // runs on, i.e. status.desiredNumberScheduled.)
    const [deployments, daemonsets, statefulsets] = await Promise.all([
        apps.listDeploymentForAllNamespaces(),
        apps.listDaemonSetForAllNamespaces(),
        apps.listStatefulSetForAllNamespaces(),
    ]);
    return [
        ...deployments.items.map((d: V1Deployment) =>
            toWorkload(d.metadata, d.spec?.template, "deployment", d.spec?.replicas ?? null, managedByMap)),
        ...daemonsets.items.map((ds: V1DaemonSet) =>
            toWorkload(ds.metadata, ds.spec?.template, "daemonset", ds.status?.desiredNumberScheduled ?? null, managedByMap)),
        ...statefulsets.items.map((s: V1StatefulSet) =>
            toWorkload(s.metadata, s.spec?.template, "statefulset", s.spec?.replicas ?? null, managedByMap)),
    ];
}

export function toAutoscalerInventory(h: V2HorizontalPodAutoscaler): AutoscalerInventory {
    const ref = h.spec?.scaleTargetRef;
    const firstMetric = h.spec?.metrics?.[0];
    return {
      kind: "hpa",
      namespace: h.metadata?.namespace ?? "default",
      targetWorkload: ref?.name ?? "",
      targetKind: (ref?.kind?.toLowerCase() ?? null) as WorkloadKind | null,
      minReplicas: h.spec?.minReplicas ?? null,
      maxReplicas: h.spec?.maxReplicas ?? null,
      metric: firstMetric?.resource?.name ?? firstMetric?.type ?? null,
      target: null,
      updateMode: null,
    };
}

export async function collectAutoscalers(api: AutoscalingV2Api): Promise<AutoscalerInventory[]> {
    const res = await api.listHorizontalPodAutoscalerForAllNamespaces();
    return res.items.map(toAutoscalerInventory);
}
  
  // "namespace/kind/name" → autoscaler kind ("hpa" | "vpa" | "keda")
export function buildManagedByMap(autoscalers: AutoscalerInventory[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const a of autoscalers) {
      if (a.targetKind) m.set(`${a.namespace}/${a.targetKind}/${a.targetWorkload}`, a.kind);
    }
    return m;
}

// Build the set of "namespace/claimName" that some pod actually mounts, so we can
// tell mounted PVCs from orphaned (bound-but-unused) ones. Keyed by namespace
// because PVC names are only unique within a namespace.
export async function collectMountedClaims(core: CoreV1Api): Promise<Set<string>> {
    const res = await core.listPodForAllNamespaces();
    const mounted = new Set<string>();
    for (const pod of res.items) {
        const ns = pod.metadata?.namespace ?? "";
        for (const vol of pod.spec?.volumes ?? []) {
            const claim = vol.persistentVolumeClaim?.claimName;
            if (claim) mounted.add(`${ns}/${claim}`);
        }
    }
    return mounted;
}

export function toPvcInventory(p: V1PersistentVolumeClaim, mountedClaims: Set<string>): PvcInventory {
    const cap = p.status?.capacity?.storage ?? p.spec?.resources?.requests?.storage;
    const namespace = p.metadata?.namespace ?? "";
    const name = p.metadata?.name ?? "";
    return {
      namespace,
      name,
      storageClass: p.spec?.storageClassName ?? null,
      capacityBytes: memToBytes(cap) ?? null,   // storage uses the same Ki/Mi/Gi suffixes
      volumeType: null,
      bound: p.status?.phase === "Bound",
      mounted: mountedClaims.has(`${namespace}/${name}`),
    };
}
export async function collectPvcs(core: CoreV1Api, mountedClaims: Set<string>): Promise<PvcInventory[]> {
    const res = await core.listPersistentVolumeClaimForAllNamespaces();
    return res.items.map((p) => toPvcInventory(p, mountedClaims));
}
  
export function toServiceInventory(s: V1Service): ServiceInventory {
    return {
      namespace: s.metadata?.namespace ?? "",
      name: s.metadata?.name ?? "",
      type: s.spec?.type ?? null,
      hasTraffic: null,                         // needs metrics; Stage G territory
    };
}
export async function collectServices(core: CoreV1Api): Promise<ServiceInventory[]> {
    const res = await core.listServiceForAllNamespaces();
    return res.items.map(toServiceInventory);
}
  
export function toPdbInventory(p: V1PodDisruptionBudget): PdbInventory {
    return {
      namespace: p.metadata?.namespace ?? "",
      name: p.metadata?.name ?? "",
      // minAvailable/maxUnavailable are IntOrString ("1" or "50%") → normalize to string
      minAvailable: p.spec?.minAvailable != null ? String(p.spec.minAvailable) : null,
      maxUnavailable: p.spec?.maxUnavailable != null ? String(p.spec.maxUnavailable) : null,
      selector: (p.spec?.selector ?? null) as unknown as Record<string, unknown> | null,
    };
}
export async function collectPdbs(policy: PolicyV1Api): Promise<PdbInventory[]> {
    const res = await policy.listPodDisruptionBudgetForAllNamespaces();
    return res.items.map(toPdbInventory);
}

/**
 * Collect the whole cluster inventory and assemble a contract-valid inventory
 * Snapshot. Stage H will push the returned snapshot to the ingestion API.
 */
export async function collectInventorySnapshot(
    kc: KubeConfig,
    clusterId: string,
    agentVersion: string,
): Promise<Snapshot> {
    const core = kc.makeApiClient(CoreV1Api);
    const apps = kc.makeApiClient(AppsV1Api);
    const autoscaling = kc.makeApiClient(AutoscalingV2Api);
    const policy = kc.makeApiClient(PolicyV1Api);

    const autoscalers = await collectAutoscalers(autoscaling);
    const managedBy = buildManagedByMap(autoscalers);
    const mountedClaims = await collectMountedClaims(core); // for PVC mounted/orphaned detection

    const inventory = {
        nodes: await collectNodes(core),
        workloads: await collectWorkloads(apps, managedBy),
        autoscalers,
        pdbs: await collectPdbs(policy),
        pvcs: await collectPvcs(core, mountedClaims),
        services: await collectServices(core),
    };

    const now = new Date().toISOString();
    const snapshot: Snapshot = {
        contractVersion: "2.0",
        agentVersion,
        clusterId,
        capturedAt: now,
        idempotencyKey: serializeIdempotencyKey({
            clusterId,
            target: "inventory",
            windowStart: now,
            windowEnd: now,
            agentVersion,
        }),
        payloadKind: "inventory",
        gitopsController: "none",
        inventory,
    };

    // Throws if anything doesn't match the shared contract.
    return Snapshot.parse(snapshot);
}