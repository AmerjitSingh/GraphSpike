"use client";

import { GraphCanvas } from "@/graph-canvas";
import type { GraphNode, GraphEdge } from "@/graph-canvas";
import { GraphStage, InfoPanel } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { CIRCLE_RADIUS } from "./_shared/data";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

const NODE_COUNT = 100;

function buildGraph(): {
  nodes: GraphNode<CircleNodeData>[];
  edges: GraphEdge<DemoEdgeData>[];
} {
  const nodes: GraphNode<CircleNodeData>[] = [];
  const edges: GraphEdge<DemoEdgeData>[] = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({ id: `n-${i}`, data: { label: `${i}`, role: "Node" } });
  }
  // Spanning chain for full connectivity.
  for (let i = 0; i < NODE_COUNT - 1; i++) {
    edges.push({ id: `e-${i}`, source: `n-${i}`, target: `n-${i + 1}`, data: { label: "" } });
  }
  // Cross-links for visual density.
  let extra = NODE_COUNT - 1;
  for (let i = 0; i + 8 < NODE_COUNT; i += 3) {
    edges.push({ id: `e-${extra++}`, source: `n-${i}`, target: `n-${i + 8}`, data: { label: "" } });
  }
  return { nodes, edges };
}

const { nodes, edges } = buildGraph();

export function GraphNavigatorDemo() {
  return (
    <div>
      <GraphStage>
        <GraphCanvas<CircleNodeData, DemoEdgeData>
          nodes={nodes}
          edges={edges}
          getNodeRadius={() => CIRCLE_RADIUS}
          renderNode={CircleNode}
          renderCanvasNode={renderCircleCanvasNode}
          layoutEnabled
          layoutLinkDistance={100}
          layoutChargeStrength={-100}
          marqueeSelect
          showMinimap
        />
      </GraphStage>
      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>100 nodes.</div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
          The blue rectangle in the minimap is the current viewport. Click or drag
          inside it to pan; the wheel zooms and the rectangle resizes to match.
        </div>
      </InfoPanel>
    </div>
  );
}
