// LABELS. We keep only an allowlist of known-safe keys and drop the rest.

import type { Snapshot } from "@kubepilot/contract";

// Exact keys we always keep (identity/grouping the engine needs).
const ALLOWED_LABEL_KEYS = new Set<string>([
  "app",
  "component",
  "tier",
  "k8s-app",
  "node.kubernetes.io/instance-type",
  "topology.kubernetes.io/region",
  "topology.kubernetes.io/zone",
  "kubernetes.io/arch",
  "kubernetes.io/os",
]);

// Key PREFIXES we keep (families of standard, non-sensitive labels).
const ALLOWED_LABEL_PREFIXES = [
  "app.kubernetes.io/",   // standard recommended labels (name, instance, component…)
  "eks.amazonaws.com/",   // node-group identity
  "cloud.google.com/",    // gke nodepool
  "karpenter.sh/",        // karpenter pools
];

/** True if a label key is safe to send. */
export function isAllowedLabel(key: string): boolean {
  if(ALLOWED_LABEL_KEYS.has(key)) return true;
  return ALLOWED_LABEL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Keep only allowlisted entries of a labels map. */
export function stripLabels(labels: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).filter(([key]) => isAllowedLabel(key)),
  );
}

/**
 * Return a copy of the snapshot safe to egress. Currently: allowlist labels on
 * every node and workload in an inventory payload. Usage snapshots have no
 * labels, so they pass through unchanged.
 */
export function sanitizeSnapshot(snapshot: Snapshot): Snapshot {
  if (!snapshot.inventory) {
    return snapshot;
  }

  return {
    ...snapshot,
    inventory: {
      ...snapshot.inventory,
      nodes: snapshot.inventory.nodes.map((node) => ({
        ...node,
        labels: stripLabels(node.labels),
      })),
      workloads: snapshot.inventory.workloads.map((workload) => ({
        ...workload,
        labels: stripLabels(workload.labels),
      })),
    },
  };
}