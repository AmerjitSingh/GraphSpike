"use client";

import { GraphCanvas } from "@/graph-canvas";
import { GraphStage } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { circleNodes, demoEdges, CIRCLE_RADIUS } from "./_shared/data";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

export function CircleRenderDemo() {
  return (
    <GraphStage>
      <GraphCanvas<CircleNodeData, DemoEdgeData>
        nodes={circleNodes}
        edges={demoEdges}
        getNodeRadius={() => CIRCLE_RADIUS}
        renderNode={CircleNode}
        renderCanvasNode={renderCircleCanvasNode}
        onConnect={(connection) => console.log("connect", connection)}
        onNodeDoubleClick={(id) => console.log("dbl click", id)}
      />
    </GraphStage>
  );
}
