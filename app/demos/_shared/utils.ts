import { getAnchorPoint } from "@/graph-canvas";
import type { GraphEdge, GraphNode, NodeAnchorProps, NodePosition, EdgeRouteType } from "@/graph-canvas";
import {
  CIRCLE_RADIUS,
  ROUNDED_RECT_WIDTH,
  ROUNDED_RECT_HEIGHT,
  ROUNDED_RECT_CORNER_RADIUS,
  ROUNDED_RECT_COLLISION_RADIUS,
  SOURCE_CONNECTOR_ANCHOR_OFFSET,
} from "./data";
import type {
  CircleNodeData,
  EditorEdgeData,
  EditorNodeData,
  EditorNodeShape,
  MixedNodeData,
  RoundedRectNodeData,
} from "./data";

// ─── Rounded-rectangle anchor ─────────────────────────────────────────────────

export function getRoundedRectAnchorPoint(
  position: NodePosition,
  target: NodePosition,
  width: number,
  height: number,
  cornerRadius: number
): NodePosition {
  const dx = target.x - position.x;
  const dy = target.y - position.y;

  if (dx === 0 && dy === 0) return position;

  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  const ux = Math.abs(dx);
  const uy = Math.abs(dy);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.max(0, Math.min(cornerRadius, halfWidth, halfHeight));
  const innerWidth = halfWidth - radius;
  const innerHeight = halfHeight - radius;

  if (ux === 0) return { x: position.x, y: position.y + sy * halfHeight };
  if (uy === 0) return { x: position.x + sx * halfWidth, y: position.y };

  const verticalT = halfWidth / ux;
  const verticalY = uy * verticalT;
  if (verticalY <= innerHeight) {
    return { x: position.x + sx * halfWidth, y: position.y + sy * verticalY };
  }

  const horizontalT = halfHeight / uy;
  const horizontalX = ux * horizontalT;
  if (horizontalX <= innerWidth) {
    return { x: position.x + sx * horizontalX, y: position.y + sy * halfHeight };
  }

  if (radius === 0) {
    const scale = Math.max(ux / halfWidth, uy / halfHeight, 1e-6);
    return { x: position.x + dx / scale, y: position.y + dy / scale };
  }

  const cx = innerWidth;
  const cy = innerHeight;
  const a = ux * ux + uy * uy;
  const b = -2 * (ux * cx + uy * cy);
  const c = cx * cx + cy * cy - radius * radius;
  const discriminant = Math.max(0, b * b - 4 * a * c);
  const sqrtDiscriminant = Math.sqrt(discriminant);
  const candidates = [(-b - sqrtDiscriminant) / (2 * a), (-b + sqrtDiscriminant) / (2 * a)]
    .filter((v) => Number.isFinite(v) && v > 0)
    .toSorted((l, r) => l - r);

  for (const t of candidates) {
    const x = ux * t;
    const y = uy * t;
    if (x >= innerWidth && y >= innerHeight) {
      return { x: position.x + sx * x, y: position.y + sy * y };
    }
  }

  return { x: position.x + sx * halfWidth, y: position.y + sy * halfHeight };
}

export function getRoundedRectangleAnchor({
  position,
  target,
}: NodeAnchorProps<RoundedRectNodeData>): NodePosition {
  return getRoundedRectAnchorPoint(
    position,
    target,
    ROUNDED_RECT_WIDTH,
    ROUNDED_RECT_HEIGHT,
    ROUNDED_RECT_CORNER_RADIUS
  );
}

// ─── Mixed-shape helpers ──────────────────────────────────────────────────────

export function getMixedNodeRadius(node: GraphNode<MixedNodeData>): number {
  return node.data.shape === "circle" ? CIRCLE_RADIUS : ROUNDED_RECT_COLLISION_RADIUS;
}

/** Bounding box per shape — used to place ports on the node's real outline. */
export function getMixedNodeSize(node: GraphNode<MixedNodeData>) {
  return node.data.shape === "circle"
    ? { width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 }
    : { width: ROUNDED_RECT_WIDTH, height: ROUNDED_RECT_HEIGHT };
}

export function getMixedNodeAnchor({
  node,
  position,
  target,
}: NodeAnchorProps<MixedNodeData>): NodePosition {
  if (node.data.shape === "circle") {
    return getAnchorPoint(position, target, CIRCLE_RADIUS);
  }
  return getRoundedRectAnchorPoint(
    position,
    target,
    ROUNDED_RECT_WIDTH,
    ROUNDED_RECT_HEIGHT,
    ROUNDED_RECT_CORNER_RADIUS
  );
}

export function getMixedConnectionError(
  sourceNode: GraphNode<MixedNodeData>,
  targetNode: GraphNode<MixedNodeData>
): string | null {
  if (sourceNode.data.shape === "circle" && targetNode.data.shape !== "rectangle") {
    return "Circles can only connect to rectangles.";
  }
  if (sourceNode.data.shape === "rectangle" && targetNode.data.shape !== "rectangle") {
    return "Rectangles can only connect to other rectangles.";
  }
  return null;
}

// ─── Edge-create demo anchor ──────────────────────────────────────────────────

export function getEdgeCreateNodeAnchor({
  node,
  position,
  target,
}: NodeAnchorProps<CircleNodeData>): NodePosition {
  if (node.id === "source") {
    return { x: position.x + SOURCE_CONNECTOR_ANCHOR_OFFSET, y: position.y };
  }
  return getAnchorPoint(position, target, CIRCLE_RADIUS);
}

// ─── Editor helpers ───────────────────────────────────────────────────────────

export function getEditorNodeRadius(node: GraphNode<EditorNodeData>): number {
  return node.data.shape === "circle" ? CIRCLE_RADIUS : ROUNDED_RECT_COLLISION_RADIUS;
}

/** Bounding box per shape — used to place ports on the node's real outline. */
export function getEditorNodeSize(node: GraphNode<EditorNodeData>) {
  return node.data.shape === "circle"
    ? { width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 }
    : { width: ROUNDED_RECT_WIDTH, height: ROUNDED_RECT_HEIGHT };
}

export function getEditorNodeAnchor({
  node,
  position,
  target,
}: NodeAnchorProps<EditorNodeData>): NodePosition {
  if (node.data.shape === "circle") {
    return getAnchorPoint(position, target, CIRCLE_RADIUS);
  }
  return {
    x: position.x + (target.x >= position.x ? ROUNDED_RECT_WIDTH / 2 : -ROUNDED_RECT_WIDTH / 2),
    y: position.y,
  };
}

export function getRouteLabel(route: EdgeRouteType): string {
  switch (route) {
    case "straight":
      return "straight";
    case "curved":
      return "curved";
    case "s-curved":
      return "s-curved";
    case "angled":
      return "angled";
  }
}

export function getEditorEdgeStyle(edge: GraphEdge<EditorEdgeData>) {
  const strokeDasharray = edge.data.dashed ? "10 6" : undefined;
  switch (edge.data.route) {
    case "straight":
      return { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray };
    case "curved":
      return { stroke: "#93c5fd", strokeWidth: 2.15, strokeDasharray };
    case "s-curved":
      return { stroke: "#38bdf8", strokeWidth: 2.2, strokeDasharray };
    case "angled":
      return { stroke: "#5eead4", strokeWidth: 2, strokeDasharray };
  }
}

export function getRouteCurveStrength(route: EdgeRouteType): number {
  switch (route) {
    case "curved":
      return 1.35;
    case "s-curved":
      return 1.7;
    default:
      return 1;
  }
}

export function createEditorNode(
  index: number,
  shape: EditorNodeShape
): GraphNode<EditorNodeData> {
  return {
    id: `editor-node-${index}`,
    data: {
      shape,
      label: `Node ${index}`,
      caption: shape === "circle" ? "Circle" : "Rectangle",
    },
  };
}

export function createEditorEdge(
  index: number,
  source: string,
  target: string,
  route: EdgeRouteType,
  dashed: boolean
): GraphEdge<EditorEdgeData> {
  return {
    id: `editor-edge-${index}`,
    source,
    target,
    data: { label: getRouteLabel(route), route, dashed },
  };
}
