"use client";

import { startTransition, useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { Connection, GraphEdge } from "@/graph-canvas";
import { GraphStage, SourceConnectorHandle, InfoPanel, outputPortFor } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { edgeCreateNodes, edgeCreatePositions, CIRCLE_RADIUS } from "./_shared/data";
import { getEdgeCreateNodeAnchor } from "./_shared/utils";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

// Only the Source node offers an outgoing port.
const getNodePorts = outputPortFor<CircleNodeData>(["source"]);
const renderPort = () => <SourceConnectorHandle />;

export function OnEdgeCreateDemo() {
  const [edges, setEdges] = useState<GraphEdge<DemoEdgeData>[]>([]);
  const [message, setMessage] = useState(
    "Drag the small cyan port from Source and drop it on another node."
  );

  const handleConnect = ({ source: sourceId, target: targetId }: Connection) => {
    if (sourceId === targetId) {
      setMessage("Self-connections are ignored.");
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
          id: `edge-${sourceId}-${targetId}`,
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
        <GraphCanvas<CircleNodeData, DemoEdgeData>
          nodes={edgeCreateNodes}
          edges={edges}
          initialPositions={edgeCreatePositions}
          getNodeRadius={() => CIRCLE_RADIUS}
          getNodeAnchor={getEdgeCreateNodeAnchor}
          renderNode={CircleNode}
          renderCanvasNode={renderCircleCanvasNode}
          onConnect={handleConnect}
          getNodePorts={getNodePorts}
          getNodeSize={() => ({ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 })}
          renderPort={renderPort}
        />
      </GraphStage>
      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{message}</div>
        <div style={{ fontSize: 14 }}>
          Total edges: <strong>{edges.length}</strong>
        </div>
      </InfoPanel>
    </div>
  );
}
