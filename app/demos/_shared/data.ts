import type { GraphEdge, GraphNode, NodePosition, EdgeRouteType } from "@/graph-canvas";

// ─── Data types ───────────────────────────────────────────────────────────────

export type CircleNodeData = {
  label: string;
  role: string;
};

export type RoundedRectNodeData = {
  label: string;
  status: string;
};

export type MixedNodeData =
  | { shape: "circle"; label: string; role: string }
  | { shape: "rectangle"; label: string; status: string };

export type DemoEdgeData = {
  label: string;
};

export type EdgeRouteDemoData = {
  label: string;
  route: EdgeRouteType;
  curveStrength?: number;
};

export type EditorNodeShape = "circle" | "rectangle";

export type EditorNodeData = {
  shape: EditorNodeShape;
  label: string;
  caption: string;
};

export type EditorEdgeData = {
  label: string;
  route: EdgeRouteType;
  dashed: boolean;
};

// ─── Layout constants ─────────────────────────────────────────────────────────

export const CIRCLE_RADIUS = 56;
export const CONNECTOR_PORT_SIZE = 12;
export const CONNECTOR_PORT_OUTSET = 10;
export const ROUNDED_RECT_WIDTH = 168;
export const ROUNDED_RECT_HEIGHT = 108;
export const ROUNDED_RECT_CORNER_RADIUS = 28;
export const ROUNDED_RECT_COLLISION_RADIUS = Math.hypot(
  ROUNDED_RECT_WIDTH / 2,
  ROUNDED_RECT_HEIGHT / 2
);
export const SOURCE_CONNECTOR_ANCHOR_OFFSET =
  CIRCLE_RADIUS + CONNECTOR_PORT_OUTSET + CONNECTOR_PORT_SIZE / 2;
export const EDGE_ROUTE_OPTIONS: EdgeRouteType[] = [
  "straight",
  "curved",
  "s-curved",
  "angled",
];

// ─── Circle demo ─────────────────────────────────────────────────────────────

export const circleNodes: GraphNode<CircleNodeData>[] = [
  { id: "a", data: { label: "Node A", role: "Owner" } },
  { id: "b", data: { label: "Node B", role: "Editor" } },
];

export const demoEdges: GraphEdge<DemoEdgeData>[] = [
  { id: "e1", source: "a", target: "b", data: { label: "connects" } },
];

// ─── Rounded-rectangle demo ───────────────────────────────────────────────────

export const roundedRectNodes: GraphNode<RoundedRectNodeData>[] = [
  { id: "gateway", data: { label: "Node A", status: "Gateway" } },
  { id: "worker", data: { label: "Node B", status: "Worker" } },
];

export const roundedRectEdges: GraphEdge<DemoEdgeData>[] = [
  { id: "e1", source: "gateway", target: "worker", data: { label: "routes to" } },
];

// ─── Edge-create / preview-phase demo ─────────────────────────────────────────

export const edgeCreateNodes: GraphNode<CircleNodeData>[] = [
  { id: "source", data: { label: "Source", role: "Drag from me" } },
  { id: "review", data: { label: "Review", role: "Drop target" } },
  { id: "ship", data: { label: "Ship", role: "Drop target" } },
];

export const edgeCreatePositions: Record<string, NodePosition> = {
  source: { x: -190, y: 0 },
  review: { x: 10, y: -110 },
  ship: { x: 190, y: 90 },
};

// ─── Context-menu demo ────────────────────────────────────────────────────────

export const contextMenuNodes: GraphNode<CircleNodeData>[] = [
  { id: "source", data: { label: "Source", role: "Node / port" } },
  { id: "review", data: { label: "Review", role: "Node / edge" } },
  { id: "ship", data: { label: "Ship", role: "Node / edge" } },
];

export const contextMenuEdges: GraphEdge<DemoEdgeData>[] = [
  { id: "ctx-source-review", source: "source", target: "review", data: { label: "handoff" } },
  { id: "ctx-review-ship", source: "review", target: "ship", data: { label: "approve" } },
];

export const contextMenuPositions: Record<string, NodePosition> = {
  source: { x: -220, y: 12 },
  review: { x: 20, y: -132 },
  ship: { x: 232, y: 98 },
};

// ─── Graph-editor demo ────────────────────────────────────────────────────────

export const editorInitialNodes: GraphNode<EditorNodeData>[] = [
  { id: "editor-node-1", data: { shape: "circle", label: "Source", caption: "Circle" } },
  { id: "editor-node-2", data: { shape: "rectangle", label: "Review", caption: "Rectangle" } },
  { id: "editor-node-3", data: { shape: "rectangle", label: "Ship", caption: "Rectangle" } },
];

export const editorInitialEdges: GraphEdge<EditorEdgeData>[] = [
  {
    id: "editor-edge-1",
    source: "editor-node-1",
    target: "editor-node-2",
    data: { label: "s-curved", route: "s-curved", dashed: false },
  },
  {
    id: "editor-edge-2",
    source: "editor-node-2",
    target: "editor-node-3",
    data: { label: "angled", route: "angled", dashed: true },
  },
];

export const editorInitialPositions: Record<string, NodePosition> = {
  "editor-node-1": { x: -240, y: -12 },
  "editor-node-2": { x: 30, y: -148 },
  "editor-node-3": { x: 258, y: 92 },
};

// ─── Mixed-shape-rules demo ───────────────────────────────────────────────────

export const mixedNodes: GraphNode<MixedNodeData>[] = [
  { id: "circle", data: { shape: "circle", label: "Circle", role: "Can fan out" } },
  { id: "review", data: { shape: "rectangle", label: "Review", status: "Rectangle" } },
  { id: "ship", data: { shape: "rectangle", label: "Ship", status: "Rectangle" } },
  { id: "archive", data: { shape: "rectangle", label: "Archive", status: "Rectangle" } },
];

export const mixedPositions: Record<string, NodePosition> = {
  circle: { x: -290, y: 10 },
  review: { x: -20, y: -160 },
  ship: { x: 220, y: -10 },
  archive: { x: 110, y: 185 },
};

export const mixedNodeById = new Map(mixedNodes.map((node) => [node.id, node] as const));

// ─── Renderer demo ────────────────────────────────────────────────────────────

export const rendererNodes: GraphNode<CircleNodeData>[] = [
  { id: "north", data: { label: "North", role: "Input" } },
  { id: "east", data: { label: "East", role: "Worker" } },
  { id: "south", data: { label: "South", role: "Worker" } },
  { id: "west", data: { label: "West", role: "Queue" } },
  { id: "core", data: { label: "Core", role: "Hub" } },
];

export const rendererEdges: GraphEdge<DemoEdgeData>[] = [
  { id: "r1", source: "north", target: "core", data: { label: "feeds" } },
  { id: "r2", source: "west", target: "core", data: { label: "queues" } },
  { id: "r3", source: "core", target: "east", data: { label: "dispatches" } },
  { id: "r4", source: "core", target: "south", data: { label: "dispatches" } },
  { id: "r5", source: "north", target: "east", data: { label: "mirrors" } },
  { id: "r6", source: "west", target: "south", data: { label: "backs up" } },
  { id: "r7", source: "east", target: "south", data: { label: "syncs" } },
  { id: "r8", source: "south", target: "core", data: { label: "returns" } },
];

export const rendererPositions: Record<string, NodePosition> = {
  north: { x: 0, y: -180 },
  east: { x: 230, y: -20 },
  south: { x: 90, y: 190 },
  west: { x: -240, y: 30 },
  core: { x: 0, y: 10 },
};

// ─── Edge-routes demo ─────────────────────────────────────────────────────────

export const edgeRouteNodes: GraphNode<CircleNodeData>[] = [
  { id: "source", data: { label: "Source", role: "Route demo" } },
  { id: "curved", data: { label: "Curved", role: "Bezier" } },
  { id: "s-curved", data: { label: "S-Curve", role: "Horizontal" } },
  { id: "straight", data: { label: "Straight", role: "Linear" } },
  { id: "angled", data: { label: "Angled", role: "Orthogonal" } },
];

export const edgeRouteEdges: GraphEdge<EdgeRouteDemoData>[] = [
  {
    id: "route-curved",
    source: "source",
    target: "curved",
    data: { label: "curved", route: "curved", curveStrength: 1.9 },
  },
  {
    id: "route-s-curved",
    source: "source",
    target: "s-curved",
    data: { label: "s-curved", route: "s-curved", curveStrength: 2.15 },
  },
  {
    id: "route-straight",
    source: "source",
    target: "straight",
    data: { label: "straight", route: "straight" },
  },
  {
    id: "route-angled",
    source: "source",
    target: "angled",
    data: { label: "angled", route: "angled" },
  },
];

export const edgeRoutePositions: Record<string, NodePosition> = {
  source: { x: -280, y: 18 },
  curved: { x: 40, y: -190 },
  "s-curved": { x: 250, y: -72 },
  straight: { x: 270, y: 88 },
  angled: { x: 48, y: 228 },
};
