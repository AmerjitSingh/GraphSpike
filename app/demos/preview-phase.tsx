"use client";

import { startTransition, useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { Connection, EdgeRouteProps, GraphEdge } from "@/graph-canvas";
import { GraphStage, SourceConnectorHandle, InfoPanel, outputPortFor } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { edgeCreateNodes, edgeCreatePositions, CIRCLE_RADIUS } from "./_shared/data";
import { getEdgeCreateNodeAnchor } from "./_shared/utils";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

// Only the Source node offers an outgoing port.
const getNodePorts = outputPortFor<CircleNodeData>(["source"]);
const renderPort = () => <SourceConnectorHandle />;
const getNodeSize = () => ({ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 });

const getPreviewRoute = ({ phase }: EdgeRouteProps<CircleNodeData, DemoEdgeData>) =>
  phase === "preview" ? "s-curved" : "straight";

const getPreviewCurveStrength = ({ phase }: EdgeRouteProps<CircleNodeData, DemoEdgeData>) =>
  phase === "preview" ? 1.7 : 1;

export function PreviewPhaseDemo() {
  const [edges, setEdges] = useState<GraphEdge<DemoEdgeData>[]>([]);
  const [message, setMessage] = useState(
    'Drag from Source: preview uses the "s-curved" route, while saved edges use the "straight" route.'
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
          id: `preview-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          data: { label: `${sourceId} to ${targetId}` },
        },
      ]);
      setMessage(
        `Created edge: ${sourceId} -> ${targetId}. Preview stayed s-curved, persisted edge is straight.`
      );
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
          getNodePorts={getNodePorts}
          getNodeSize={getNodeSize}
          renderPort={renderPort}
          onConnect={handleConnect}
          getEdgeRoute={getPreviewRoute}
          getEdgeCurveStrength={getPreviewCurveStrength}
          getEdgeStyle={() => ({ stroke: "#93c5fd", strokeWidth: 2 })}
        />
      </GraphStage>
      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{message}</div>
        <div style={{ fontSize: 14 }}>
          Preview route: <strong>s-curved</strong> via <code>phase === "preview"</code>
        </div>
        <div style={{ fontSize: 14 }}>
          Persisted route: <strong>straight</strong> via <code>phase === "edge"</code>
        </div>
        <div style={{ fontSize: 14 }}>
          Total edges: <strong>{edges.length}</strong>
        </div>
      </InfoPanel>
    </div>
  );
}
