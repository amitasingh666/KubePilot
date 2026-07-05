import { describe, it, expect } from "vitest";
import { toWorkload } from "./collect.js";

// Minimal K8s-ish inputs; toWorkload only reads metadata + pod spec.
const meta = { namespace: "shop", name: "checkout", labels: { app: "checkout" } };
const podSpec = {
  containers: [
    {
      name: "app",
      resources: {
        requests: { cpu: "250m", memory: "256Mi" },
        limits: { cpu: "500m", memory: "512Mi" },
      },
    },
  ],
};
const noAutoscalers = new Map<string, string>();

describe("toWorkload", () => {
  it("maps a Deployment with summed resources", () => {
    const wl = toWorkload(meta as any, podSpec as any, "deployment", 3, noAutoscalers);
    expect(wl.name).toBe("checkout");
    expect(wl.namespace).toBe("shop");
    expect(wl.kind).toBe("deployment");
    expect(wl.replicas).toBe(3);
    expect(wl.containers).toHaveLength(1);
    expect(wl.resources.cpuRequestMillicores).toBe(250);
    expect(wl.resources.cpuLimitMillicores).toBe(500);
    expect(wl.resources.memRequestBytes).toBe(256 * 1024 * 1024);
    expect(wl.managedBy).toBe("none");
  });

  it("carries the given kind (Fix 1: DaemonSet/StatefulSet now supported)", () => {
    expect(toWorkload(meta as any, podSpec as any, "daemonset", null, noAutoscalers).kind).toBe("daemonset");
    expect(toWorkload(meta as any, podSpec as any, "statefulset", 2, noAutoscalers).kind).toBe("statefulset");
  });

  it("builds the managedBy key from the real kind, not a hardcoded 'deployment' (regression)", () => {
    // Pre-fix the key was always `${ns}/deployment/${name}`, so a StatefulSet's
    // autoscaler would never match. It must key on the actual kind now.
    const map = new Map<string, string>([["shop/statefulset/checkout", "hpa"]]);
    expect(toWorkload(meta as any, podSpec as any, "statefulset", 2, map).managedBy).toBe("hpa");
    // A deployment with the same name must NOT pick up the statefulset's autoscaler.
    expect(toWorkload(meta as any, podSpec as any, "deployment", 3, map).managedBy).toBe("none");
  });

  it("sums resources across multiple containers", () => {
    const twoContainers = {
      containers: [
        { name: "a", resources: { requests: { cpu: "100m", memory: "100Mi" } } },
        { name: "b", resources: { requests: { cpu: "150m", memory: "50Mi" } } },
      ],
    };
    const wl = toWorkload(meta as any, twoContainers as any, "deployment", 1, noAutoscalers);
    expect(wl.resources.cpuRequestMillicores).toBe(250);
    expect(wl.resources.memRequestBytes).toBe(150 * 1024 * 1024);
  });
});
