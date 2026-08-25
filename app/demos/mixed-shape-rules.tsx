"use client";

import { startTransition, useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { Connection, GraphEdge, PortRenderProps } from "@/graph-canvas";
import { GraphStage, InfoPanel, singleOutputPort } from "./_shared/ui";
import { MixedShapeNode } from "./_shared/node-renderers";
import { renderMixedCanvasNode } from "./_shared/canvas-renderers";
import { mixedNodes, mixedPositions, mixedNodeById } from "./_shared/data";
import {
  getMixedNodeRadius,
  getMixedNodeSize,
  getMixedNodeAnchor,
  getMixedConnectionError,
} from "./_shared/utils";
import type { MixedNodeData, DemoEdgeData } from "./_shared/data";

const renderPort = ({ node }: PortRenderProps<MixedNodeData>) => (
  <div
    style={{
      width: 10,
      height: 10,
      borderRadius: "50%",
      background:
        node.data.shape === "circle" ? "#67d7ff" : "rgba(153, 246, 228, 0.95)",
      border: "2px solid rgba(3, 37, 74, 0.9)",
      boxShadow: "0 0 0 3px rgba(3, 37, 74, 0.28)",
    }}
  />
);

export function MixedShapeRulesDemo() {
  const [edges, setEdges] = useState<GraphEdge<DemoEdgeData>[]>([]);
  const [message, setMessage] = useState(
    "Rules: circle -> many rectangles. rectangle -> rectangle only."
  );

  const handleConnect = ({ source: sourceId, target: targetId }: Connection) => {
    const sourceNode = mixedNodeById.get(sourceId);
    const targetNode = mixedNodeById.get(targetId);

    if (!sourceNode || !targetNode) {
      setMessage("Ignored edge because the source or target was missing.");
      return;
    }

    if (sourceId === targetId) {
      setMessage("Self-connections are ignored.");
      return;
    }

    const ruleError = getMixedConnectionError(sourceNode, targetNode);
    if (ruleError) {
      setMessage(`Rejected ${sourceId} -> ${targetId}. ${ruleError}`);
      return;
    }

    const duplicate = edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId
    );

    if (duplicate) {
      setMessage(`Skipped duplicate edge: ${sourceId} -> ${targetId}`);
      return;
    }

    startTransition(() => {
      setEdges((prev) => [
        ...prev,
        {
          id: `mixed-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          data: { label: `${sourceId} to ${targetId}` },
        },
      ]);
      setMessage(`Created edge: ${sourceId} -> ${targetId}`);
    });
  };


  return (
    <div>
      <GraphStage>
        <GraphCanvas<MixedNodeData, DemoEdgeData>
          nodes={mixedNodes}
          edges={edges}
          initialPositions={mixedPositions}
          layoutEnabled={false}
          getNodeRadius={getMixedNodeRadius}
          getNodeAnchor={getMixedNodeAnchor}
          getNodeShape={(node) => node.data.shape === "circle" ? "circle" : "rectangle"}
          renderNode={MixedShapeNode}
          renderCanvasNode={renderMixedCanvasNode}
          getNodePorts={singleOutputPort}
          getNodeSize={getMixedNodeSize}
          renderPort={renderPort}
          onConnect={handleConnect}
        />
      </GraphStage>
      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{message}</div>
        <div style={{ fontSize: 14 }}>
          Allowed: <strong>circle {"->"} rectangle</strong> and{" "}
          <strong>rectangle {"->"} rectangle</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Blocked: <strong>rectangle {"->"} circle</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Total edges: <strong>{edges.length}</strong>
        </div>
      </InfoPanel>
    </div>
  );
}
