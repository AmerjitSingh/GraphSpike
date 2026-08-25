"use client";

import { GraphCanvas } from "@/graph-canvas";
import type { EdgeControlPointProps } from "@/graph-canvas";
import { GraphStage } from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import { edgeRouteNodes, edgeRouteEdges, edgeRoutePositions, CIRCLE_RADIUS } from "./_shared/data";
import type { CircleNodeData, EdgeRouteDemoData } from "./_shared/data";

function getEdgeRouteDemoControlPoints({
  edge,
  route,
  defaultControlPoints,
}: EdgeControlPointProps<CircleNodeData, EdgeRouteDemoData>) {
  if (!edge) return null;

  if (route === "curved" && edge.id === "route-curved") {
    return {
      c1: { x: defaultControlPoints.c1.x - 14, y: defaultControlPoints.c1.y - 42 },
      c2: { x: defaultControlPoints.c2.x + 18, y: defaultControlPoints.c2.y - 34 },
    };
  }

  if (route === "s-curved" && edge.id === "route-s-curved") {
    return {
      c1: { x: defaultControlPoints.c1.x + 26, y: defaultControlPoints.c1.y },
      c2: { x: defaultControlPoints.c2.x - 28, y: defaultControlPoints.c2.y },
    };
  }

  return null;
}

export function EdgeRoutesDemo() {
  return (
    <GraphStage>
      <GraphCanvas<CircleNodeData, EdgeRouteDemoData>
        nodes={edgeRouteNodes}
        edges={edgeRouteEdges}
        initialPositions={edgeRoutePositions}
        layoutEnabled={false}
        getNodeRadius={() => CIRCLE_RADIUS}
        renderNode={CircleNode}
        renderCanvasNode={renderCircleCanvasNode}
        getEdgeRoute={({ edge }) => edge?.data.route ?? "straight"}
        getEdgeCurveStrength={({ edge }) => edge?.data.curveStrength ?? 1}
        getEdgeControlPoints={getEdgeRouteDemoControlPoints}
        getEdgeStyle={(edge) => {
          switch (edge.data.route) {
            case "curved":
              return { stroke: "#93c5fd" };
            case "s-curved":
              return { stroke: "#38bdf8", strokeWidth: 2.2 };
            case "straight":
              return { stroke: "#f59e0b" };
            case "angled":
              return { stroke: "#5eead4", strokeDasharray: "8 4" };
          }
        }}
      />
    </GraphStage>
  );
}
