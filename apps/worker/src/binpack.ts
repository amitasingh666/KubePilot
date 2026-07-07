// First-Fit-Decreasing bin-packing simulator (v1: capacity-based estimate).
//
// Honest scope: this packs on CPU+memory FIT only. It does NOT yet model
// nodeSelector / taints / affinity / anti-affinity / topology-spread / PVC-affinity
// / GPU, and we don't have live pod→node placement — so the result is an
// UPPER-BOUND "capacity efficiency" estimate ("you could fit on N nodes"), not a
// proven drain plan. Real constraints can only make N larger, never smaller.

export type SimNode = { cpuM: number; memBytes: number }; // effective capacity (allocatable×buffer − DaemonSet overhead)
export type SimPod = { cpuM: number; memBytes: number };

export type SimResult = { totalNodes: number; nodesNeeded: number; reclaimable: number };

/**
 * Pack pods onto the fewest of the given nodes (largest-first), by fit only.
 * Returns how many nodes are actually needed vs available. If any pod can't be
 * placed (doesn't fit even an empty node, or we run out), we conservatively
 * report 0 reclaimable — never overstate.
 */
export function simulateCluster(nodes: SimNode[], pods: SimPod[]): SimResult {
  const totalNodes = nodes.length;
  if (totalNodes === 0) return { totalNodes: 0, nodesNeeded: 0, reclaimable: 0 };

  // Open bigger nodes first (better packing); place bigger pods first (FFD).
  const pool = [...nodes].sort((a, b) => b.cpuM - a.cpuM);
  const sortedPods = [...pods].sort((a, b) => b.cpuM - a.cpuM);

  const open: SimNode[] = []; // remaining capacity of nodes we've opened
  let nextNode = 0;

  for (const pod of sortedPods) {
    // Try an already-open node.
    let placed = false;
    for (const n of open) {
      if (n.cpuM >= pod.cpuM && n.memBytes >= pod.memBytes) {
        n.cpuM -= pod.cpuM;
        n.memBytes -= pod.memBytes;
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // Open a fresh node from the pool.
    if (nextNode >= pool.length) return { totalNodes, nodesNeeded: totalNodes, reclaimable: 0 };
    const cap = pool[nextNode++]!;
    if (cap.cpuM < pod.cpuM || cap.memBytes < pod.memBytes) {
      // Pod doesn't fit even an empty node → can't safely consolidate.
      return { totalNodes, nodesNeeded: totalNodes, reclaimable: 0 };
    }
    open.push({ cpuM: cap.cpuM - pod.cpuM, memBytes: cap.memBytes - pod.memBytes });
  }

  const nodesNeeded = open.length;
  return { totalNodes, nodesNeeded, reclaimable: Math.max(0, totalNodes - nodesNeeded) };
}
