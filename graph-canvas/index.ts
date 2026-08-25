// ─── Main component ───────────────────────────────────────────────────────────
export { GraphCanvas } from "./GraphCanvas.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  CanvasContextMenuTarget,
  BezierEdgeRouteType,
  Connection,
  ConnectionContext,
  EdgeContextMenuTarget,
  EdgeBezierControlPoints,
  EdgeControlPointOverride,
  EdgeControlPointProps,
  EdgeToolbarProps,
  GraphContextMenuProps,
  GraphContextMenuTarget,
  EdgeRouteProps,
  EdgeRouteType,
  GraphNode,
  GraphEdge,
  NodeContextMenuTarget,
  NodePosition,
  NodeSize,
  PortBehavior,
  PortContextMenuTarget,
  PortDef,
  PortHandleParts,
  PortMode,
  PortRenderProps,
  PortSide,
  Viewport,
  EdgeStyle,
  NodeAnchorProps,
  NodeRenderProps,
  GraphCanvasProps,
  GraphCanvasRef,
  RenderCanvasNodeProps,
  RenderCanvasPortProps,
} from "./types.js";

// ─── Utilities (useful if you build custom renderers or extensions) ───────────
export {
  getNodeRadius,
  getNodeAnchor,
  getAnchorPoint,
  getEdgeAnchors,
  getEdgeControlPoints,
  getEdgeRouteGeometry,
  isBezierEdgeRoute,
  DEFAULT_EDGE_ROUTE,
  buildEdgePath,
  EDGE_CONTROL_POINT_START,
  EDGE_CONTROL_POINT_END,
  EDGE_CURVE_BEND_RATIO,
  EDGE_CURVE_BEND_MIN,
  EDGE_CURVE_BEND_MAX,
  EDGE_S_CURVE_HANDLE_MIN,
  EDGE_S_CURVE_HANDLE_MAX,
} from "./geometry.js";
export { getSeedPositions } from "./layout.js";
export { SpatialIndex } from "./spatialIndex.js";

// ─── Ports ────────────────────────────────────────────────────────────────────
export {
  createPortHandleId,
  parsePortHandleId,
  getPortPositions,
  getPortPosition,
  getPortAnchor,
  getPortExtent,
  getPortGlyph,
  getPortNormal,
  getPortSide,
  findPort,
  DEFAULT_NODE_SIZE,
  MAIN_PORT_TYPE,
  PORT_BAR_HEIGHT,
  PORT_BAR_WIDTH,
  PORT_HIT_RADIUS,
  PORT_SIZE,
} from "./ports.js";
export type { PortGlyph } from "./ports.js";

// ─── Store hook (for reading canvas state from outside) ───────────────────────
export { useGraphCanvasStore } from "./store.js";

// ─── Cross-graph linking ──────────────────────────────────────────────────────
export { createGraphLink, resolveExternalDropHandler } from "./link/GraphLink.js";
export type {
  GraphLink,
  GraphLinkState,
  GraphLinkPublish,
  GraphLinkRegistration,
  CrossDragPayload,
  ExternalDropHandler,
} from "./link/GraphLink.js";
export {
  GraphLinkProvider,
  GraphLinkContext,
  useGraphLink,
  useGraphLinkState,
} from "./link/context.js";

// Store actions are intentionally not re-exported. Use `useGraphCanvasStore()` instead.

// ─── Overlay utilities ───────────────────────────────────────────────────────
export { useOverlayDrag } from "./hooks/useOverlayDrag.js";
export type { OverlayDragHandle } from "./hooks/useOverlayDrag.js";

// ─── Minimap navigator (built-in via showMinimap, or place manually) ──────────
export { MiniMap } from "./renderers/MiniMap.js";
export type { MiniMapProps } from "./renderers/MiniMap.js";

// ─── Accessibility ────────────────────────────────────────────────────────────
export { AccessibilityLayer } from "./renderers/AccessibilityLayer.js";
export { GC_CHROME_SELECTOR } from "./GraphCanvas.js";
