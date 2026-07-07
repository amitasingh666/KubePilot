import type { AnyRecommendation } from "./persistRecommendations.js";

export type Patch = { patch: string; patchMode: "kubectl" | "gitops" };

const mib = (b: number) => `${Math.round(b / 1048576)}Mi`;

// Imperative kubectl patches get reverted by ArgoCD/Flux — so for GitOps-owned
// workloads we emit the same change as a "apply to your source manifest" note.
function wrap(cmd: string, gitopsOwned: boolean): Patch {
  if (!gitopsOwned) return { patch: cmd, patchMode: "kubectl" };
  return {
    patch: `# GitOps-owned: apply this to your source manifest / values (a kubectl patch would be reverted).\n# Equivalent change:\n${cmd}`,
    patchMode: "gitops",
  };
}

/**
 * Build a copy-paste patch for a recommendation (recommend-only — the user applies it).
 * Returns null when there's no single imperative command (e.g. node consolidation,
 * realized via the autoscaler / node-pool resize).
 *
 * Note: workload recs are workload-level; `set resources` applies to ALL containers,
 * so multi-container workloads may need a per-container split (flagged for later).
 */
export function buildPatch(rec: AnyRecommendation, gitopsOwned: boolean): Patch | null {
  switch (rec.type) {
    case "cpu-rightsize":
      return wrap(
        `kubectl -n ${rec.namespace} set resources deployment/${rec.name} --requests=cpu=${rec.proposedCpuM}m`,
        gitopsOwned,
      );
    case "memory-rightsize": {
      const m = mib(rec.proposedMemBytes);
      return wrap(
        `kubectl -n ${rec.namespace} set resources deployment/${rec.name} --requests=memory=${m} --limits=memory=${m}`,
        gitopsOwned,
      );
    }
    case "replica-optimize":
      return wrap(
        `kubectl -n ${rec.namespace} scale deployment/${rec.name} --replicas=${rec.proposedReplicas}`,
        gitopsOwned,
      );
    case "cleanup":
      return wrap(
        `kubectl -n ${rec.namespace} delete deployment/${rec.name}   # confirm it's truly unused first`,
        gitopsOwned,
      );
    case "pvc-cleanup":
      // Destroys data — never auto-apply; a plain kubectl command with a loud warning.
      return { patch: `kubectl -n ${rec.namespace} delete pvc ${rec.name}   # ⚠️ DESTROYS DATA — confirm first`, patchMode: "kubectl" };
    case "node-consolidate":
      return null; // no single command — realized by Karpenter/cluster-autoscaler or a node-pool resize
    default: {
      const _exhaustive: never = rec;
      throw new Error(`unhandled rec type for patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
