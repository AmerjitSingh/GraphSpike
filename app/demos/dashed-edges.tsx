"use client";

import { GraphCanvas } from "@/graph-canvas";
import { GraphStage } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { rendererNodes, rendererEdges, rendererPositions, CIRCLE_RADIUS } from "./_shared/data";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

export function DashedEdgesDemo() {
  return (
    <GraphStage>
      <GraphCanvas<CircleNodeData, DemoEdgeData>
        nodes={rendererNodes}
        edges={rendererEdges}
        initialPositions={rendererPositions}
        layoutEnabled={false}
        getNodeRadius={() => CIRCLE_RADIUS}
        renderNode={CircleNode}
        renderCanvasNode={renderCircleCanvasNode}
        getEdgeStyle={() => ({
          stroke: "#93c5fd",
          strokeWidth: 2,
          strokeDasharray: "10 6",
        })}
      />
    </GraphStage>
  );
}
