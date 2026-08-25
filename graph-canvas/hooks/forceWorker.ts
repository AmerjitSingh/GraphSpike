// Scoped to d3-force alone: this file becomes its own worker chunk, and the
// full d3 metapackage would drag every other d3 module into it.
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

// Properly typed simulation node/link interfaces for D3 force layout.
interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  fx?: number | undefined;
  fy?: number | undefined;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export interface ForceWorkerInputData {
  nodes: { id: string; x?: number; y?: number }[];
  edges: { source: string; target: string }[];
  fixedIds: string[];
  linkDistance: number;
  chargeStrength: number;
  nodeRadii: { id: string; r: number }[];
  totalTicks: number;
}

export interface ForceWorkerOutputData {
  updates: Float32Array;
}

self.addEventListener("message", (event: MessageEvent<ForceWorkerInputData>) => {
  const payload = event.data;

  // Everything runs inside the try: d3 validates the graph while the forces are
  // being constructed (forceLink().id() throws `missing: <id>` for an edge
  // naming an unknown node), so construction outside it would kill the worker
  // silently — no "error" message, no "end", leaving the host's transient
  // phase open until its timeout.
  try {
    const fixedIdsSet = new Set(payload.fixedIds);
    const simNodes: SimNode[] = payload.nodes.map((n) => {
      const isFixed = fixedIdsSet.has(n.id);
      // Pin to the same coordinates the node starts at, so a fixed node with
      // no supplied position stays put rather than drifting from (0,0).
      return {
        id: n.id,
        x: n.x ?? 0,
        y: n.y ?? 0,
        fx: isFixed ? (n.x ?? 0) : undefined,
        fy: isFixed ? (n.y ?? 0) : undefined,
      };
    });

    const simLinks: SimLink[] = payload.edges.map((e) => ({ source: e.source, target: e.target }));

    const radiusMap = new Map(payload.nodeRadii.map(r => [r.id, r.r]));

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(payload.linkDistance)
          .strength(0.6)
      )
      .force("charge", forceManyBody().strength(payload.chargeStrength))
      .force(
        "collide",
        forceCollide<SimNode>((d) => {
          return (radiusMap.get(d.id) ?? 40) + 8;
        })
          .strength(0.85)
      )
      .force("center", forceCenter(0, 0).strength(0.05))
      .stop();

    const ticksPerChunk = 20;
    let remaining = payload.totalTicks;

    while (remaining > 0) {
      const step = Math.min(ticksPerChunk, remaining);
      simulation.tick(step);
      remaining -= step;

      // Pack the updates into a float array for fast Transfer
      const updates = new Float32Array(simNodes.length * 2);
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        updates[i * 2] = n.x ?? 0;
        updates[i * 2 + 1] = n.y ?? 0;
      }
      
      self.postMessage(
        { type: "tick", updates },
        { transfer: [updates.buffer] }
      );
    }
    
    self.postMessage({ type: "end" });
  } catch (e) {
    self.postMessage({ type: "error", error: String(e) });
  }
});
