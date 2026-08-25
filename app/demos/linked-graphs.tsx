"use client";

import { useMemo, useState } from "react";
import { GraphCanvas, createGraphLink, GraphLinkProvider } from "@/graph-canvas";
import type {
  CrossDragPayload,
  GraphEdge,
  GraphNode,
  NodePosition,
} from "@/graph-canvas";
import { GraphStage, InfoPanel, SourceConnectorHandle, singleOutputPort } from "./_shared/ui";

const circleNodeSize = () => ({ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 });
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { CIRCLE_RADIUS } from "./_shared/data";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

// The five entities both graphs describe. Shared ids are the cross-graph key,
// so a node in one graph maps to a node in the other by identity.
const allNodes: GraphNode<CircleNodeData>[] = [
  { id: "auth", data: { label: "Auth", role: "Service" } },
  { id: "api", data: { label: "API", role: "Service" } },
  { id: "db", data: { label: "DB", role: "Store" } },
  { id: "cache", data: { label: "Cache", role: "Store" } },
  { id: "queue", data: { label: "Queue", role: "Broker" } },
];
const nodeById = new Map(allNodes.map((n) => [n.id, n] as const));

// Graph A — the full source topology (static).
const edgesA: GraphEdge<DemoEdgeData>[] = [
  { id: "a-auth-api", source: "auth", target: "api", data: { label: "authorizes" } },
  { id: "a-api-db", source: "api", target: "db", data: { label: "reads" } },
  { id: "a-api-cache", source: "api", target: "cache", data: { label: "caches" } },
  { id: "a-queue-api", source: "queue", target: "api", data: { label: "feeds" } },
];
const positionsA: Record<string, NodePosition> = {
  auth: { x: -210, y: -60 },
  api: { x: 0, y: 0 },
  db: { x: 210, y: -80 },
  cache: { x: 185, y: 120 },
  queue: { x: -170, y: 150 },
};

// Graph B — starts sparse; you populate it by dragging entities over from A.
const initialNodesB: GraphNode<CircleNodeData>[] = [
  nodeById.get("api")!,
  nodeById.get("cache")!,
];
const initialEdgesB: GraphEdge<DemoEdgeData>[] = [
  { id: "b-api-cache", source: "api", target: "cache", data: { label: "serves" } },
];
const initialPositionsB: Record<string, NodePosition> = {
  api: { x: 40, y: -40 },
  cache: { x: 40, y: 130 },
};

export function LinkedGraphsDemo() {
  const link = useMemo(() => createGraphLink(), []);

  const [nodesB, setNodesB] = useState<GraphNode<CircleNodeData>[]>(initialNodesB);
  const [positionsB, setPositionsB] = useState<Record<string, NodePosition>>(initialPositionsB);
  const [status, setStatus] = useState(
    "Hover or select a node to link the graphs. To move an entity across: select it in the left graph, then drag its cyan handle onto the right graph."
  );

  const handleDropIntoB = (payload: CrossDragPayload, gx: number, gy: number) => {
    const master = nodeById.get(payload.nodeId);
    if (!master) return;
    if (nodesB.some((n) => n.id === payload.nodeId)) {
      setStatus(`"${payload.nodeId}" is already in graph B.`);
      return;
    }
    setNodesB((prev) => [...prev, master]);
    setPositionsB((prev) => ({ ...prev, [payload.nodeId]: { x: gx, y: gy } }));
    setStatus(`Dropped "${payload.nodeId}" from A into B at (${Math.round(gx)}, ${Math.round(gy)}).`);
  };

  return (
    <GraphLinkProvider link={link}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <GraphStage>
          <GraphCanvas<CircleNodeData, DemoEdgeData>
            linkId="A"
            nodes={allNodes}
            edges={edgesA}
            initialPositions={positionsA}
            layoutEnabled={false}
            crossGraphDrag
            getNodeRadius={() => CIRCLE_RADIUS}
            renderNode={CircleNode}
            renderCanvasNode={renderCircleCanvasNode}
            getNodePorts={singleOutputPort}
            getNodeSize={circleNodeSize}
            renderPort={() => <SourceConnectorHandle />}
            onNodeDoubleClick={(id) => {
              link.graph("B")?.panToNode(id, 1.1);
              setStatus(`Double-clicked "${id}" in A → panned graph B to it.`);
            }}
          />
        </GraphStage>

        <GraphStage>
          <GraphCanvas<CircleNodeData, DemoEdgeData>
            linkId="B"
            nodes={nodesB}
            edges={initialEdgesB}
            initialPositions={positionsB}
            layoutEnabled={false}
            onExternalDrop={handleDropIntoB}
            getNodeRadius={() => CIRCLE_RADIUS}
            renderNode={CircleNode}
            renderCanvasNode={renderCircleCanvasNode}
            onNodeDoubleClick={(id) => {
              link.graph("A")?.panToNode(id, 1.1);
              setStatus(`Double-clicked "${id}" in B → panned graph A to it.`);
            }}
          />
        </GraphStage>
      </div>

      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{status}</div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
          Two graphs sharing a <strong>GraphLink</strong> — no shared positions or
          viewport. Selecting or hovering a node rings the matching one in the other
          graph, and a node can be dragged across. Graph B holds{" "}
          <strong>{nodesB.length}</strong> of {allNodes.length} entities.
        </div>
      </InfoPanel>
    </GraphLinkProvider>
  );
}
