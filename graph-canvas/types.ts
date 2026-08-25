import type { ReactNode, CSSProperties } from "react";
import type { RenderCanvasNodeProps } from "./renderers/NodeCanvasLayer.js";
import type { GraphLink, CrossDragPayload } from "./link/GraphLink.js";
export type { RenderCanvasNodeProps } from "./renderers/NodeCanvasLayer.js";

// ─── Data model ────────────────────────────────────────────────────────────

export interface GraphNode<T = unknown> {
  id: string;
  data: T;
}

export interface GraphEdge<E = unknown> {
  id: string;
  source: string; // node id
  target: string; // node id
  data: E;
  /** Port id on the source node this edge originates from (undefined = default perimeter anchor). */
  sourcePort?: string;
  /** Port id on the target node this edge terminates at (undefined = default perimeter anchor). */
  targetPort?: string;
}

// ─── Engine types ───────────────────────────────────────────────────────────

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

// ─── Ports ──────────────────────────────────────────────────────────────────

export type PortMode = "input" | "output";
export type PortSide = "top" | "right" | "bottom" | "left";

/** How a port may be used.
 *
 *  - `drag` — drag from it to connect (default)
 *  - `menu` — not a drag source; shows an endpoint affordance that opens the
 *    port context menu, for picking a node type to create
 *  - `both` — drag to wire an existing node, or use the endpoint to make one
 *
 *  Every mode is a valid *drop* target; this only governs the outgoing side. */
export type PortBehavior = "drag" | "menu" | "both";

/** A typed connection endpoint on a node.
 *
 *  Ports are *data*, not DOM: the library lays them out, draws them on either
 *  the HTML or the Canvas layer, and hit-tests them through a spatial index.
 *  That's what lets an unselected canvas-rendered node still be connectable. */
export interface PortDef {
  /** Unique within the node. `createPortHandleId` builds a well-formed one. */
  id: string;
  /** Consumer-defined connection type, e.g. "main", "model", "memory".
   *  Two ports may only connect when their types match. */
  type: string;
  mode: PortMode;
  /** Shown next to the port dot. */
  label?: string;
  /** Renders a `*` marker; purely presentational — enforce it yourself. */
  required?: boolean;
  /** Maximum edges this port accepts. Undefined means unlimited. */
  maxConnections?: number;
  /** Which edge of the node the port sits on. Defaults to left/right for
   *  `type: "main"` and bottom/top for every other type. */
  side?: PortSide;
  /** How the port may be used (default: "drag"). */
  behavior?: PortBehavior;
  /** Distance from the port's centre to the point an edge attaches, measured
   *  along the outward normal. Defaults to the extent of the glyph the library
   *  draws; set this when `renderPort` draws something a different size. */
  anchorOffset?: number;
}

/** The decoded parts of a port handle id. */
export interface PortHandleParts {
  mode: PortMode;
  type: string;
  index: number;
}

/** A proposed or committed edge, identified by endpoint and port. */
export interface Connection {
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
}

/** Everything known about a connection while it is being validated. */
export interface ConnectionContext<T = unknown> extends Connection {
  sourceNode: GraphNode<T>;
  targetNode: GraphNode<T>;
  sourcePortDef?: PortDef;
  targetPortDef?: PortDef;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// ─── Render customisation ───────────────────────────────────────────────────

export interface EdgeStyle {
  /** CSS color string */
  stroke?: string;
  strokeWidth?: number;
  /** e.g. "6 4" */
  strokeDasharray?: string;
  /** render an arrowhead at the target end */
  markerEnd?: boolean;
}

export type EdgeRouteType = "curved" | "s-curved" | "straight" | "angled";
export type BezierEdgeRouteType = Extract<EdgeRouteType, "curved" | "s-curved">;

export interface NodeRenderProps<T = unknown> {
  node: GraphNode<T>;
  isSelected: boolean;
  /** True when the node is in `highlightedNodeIds` or is highlighted by a
   *  linked graph. Independent of selection — a node can be both. */
  isHighlighted: boolean;
  isDragging: boolean;
  /** True when this node holds the graph's roving keyboard focus. The visual
   *  layers are `aria-hidden` raster, so nothing else tells a keyboard user
   *  where they are. */
  isFocused: boolean;
  /** True when a keyboard connect has been armed from this node (`c`), and the
   *  graph is waiting for a target. */
  isConnectSource: boolean;
  zoom: number;
}

export interface PortRenderProps<T = unknown> {
  node: GraphNode<T>;
  port: PortDef;
  /** Which edge of the node this port resolved to. */
  side: PortSide;
  /** True while a connect drag is in flight anywhere on the canvas. */
  isConnecting: boolean;
  /** True when the in-flight drag would land on this port. */
  isSnapTarget: boolean;
  /** True when at least one edge already terminates at this port. */
  isConnected: boolean;
  zoom: number;
}

/** Canvas 2D drawing context for a single port on an unselected node.
 *  `x`/`y` are screen pixels, already transformed by the viewport. */
export interface RenderCanvasPortProps<T = unknown> {
  ctx: CanvasRenderingContext2D;
  node: GraphNode<T>;
  port: PortDef;
  side: PortSide;
  x: number;
  y: number;
  zoom: number;
}

export interface NodeAnchorProps<T = unknown> {
  node: GraphNode<T>;
  position: NodePosition;
  target: NodePosition;
  /** Port id that initiated the connection. Undefined means use the default perimeter anchor. */
  portId?: string;
}

export interface EdgeRouteProps<T = unknown, E = unknown> {
  edge?: GraphEdge<E>;
  sourceNode: GraphNode<T>;
  targetNode?: GraphNode<T>;
  source: NodePosition;
  target: NodePosition;
  phase: "edge" | "preview";
}

export interface CanvasContextMenuTarget {
  kind: "canvas";
}

export interface NodeContextMenuTarget<T = unknown> {
  kind: "node";
  node: GraphNode<T>;
  position: NodePosition;
}

export interface EdgeContextMenuTarget<T = unknown, E = unknown> {
  kind: "edge";
  edge: GraphEdge<E>;
  sourceNode: GraphNode<T>;
  targetNode: GraphNode<T>;
}

export interface PortContextMenuTarget<T = unknown> {
  kind: "port";
  node: GraphNode<T>;
  /** Undefined when the node uses a bare `[data-gc-handle]` with no port id. */
  port?: PortDef;
  /** Graph-space centre of the owning node. */
  position: NodePosition;
  /** Graph-space centre of the port itself. Use this rather than `position`
   *  when placing a node the menu creates, so it lands under the port that
   *  opened the menu rather than under the middle of the node. */
  portPosition?: NodePosition;
}

export type GraphContextMenuTarget<T = unknown, E = unknown> =
  | CanvasContextMenuTarget
  | NodeContextMenuTarget<T>
  | EdgeContextMenuTarget<T, E>
  | PortContextMenuTarget<T>;

export interface GraphContextMenuProps<T = unknown, E = unknown> {
  target: GraphContextMenuTarget<T, E>;
  containerPosition: NodePosition;
  clientPosition: NodePosition;
  graphPosition: NodePosition;
  closeMenu: () => void;
}

export interface EdgeBezierControlPoints {
  c1: NodePosition;
  c2: NodePosition;
}

export interface EdgeControlPointOverride {
  c1?: NodePosition;
  c2?: NodePosition;
}

export interface EdgeControlPointProps<T = unknown, E = unknown>
  extends EdgeRouteProps<T, E> {
  route: BezierEdgeRouteType;
  curveStrength: number;
  defaultControlPoints: EdgeBezierControlPoints;
}

export interface EdgeToolbarProps<T = unknown, E = unknown> {
  edge: GraphEdge<E>;
  sourceNode: GraphNode<T>;
  targetNode: GraphNode<T>;
  /** Graph-space midpoint of the edge — where the toolbar is anchored. */
  position: NodePosition;
}

// ─── Public component API ────────────────────────────────────────────────────

export interface GraphCanvasRef {
  /** Fit all nodes into view with animation. */
  fitToView: () => void;
  /** Pan and zoom to a specific coordinate */
  panTo: (x: number, y: number, targetZoom?: number) => void;
  /** Pan and zoom to a specific node by ID */
  panToNode: (id: string, targetZoom?: number) => void;
  /** Zoom in one step about the viewport centre. */
  zoomIn: () => void;
  /** Zoom out one step about the viewport centre. */
  zoomOut: () => void;
  /** Current zoom scale. */
  getZoom: () => number;
}

export interface GraphCanvasProps<T = unknown, E = unknown> {
  nodes: GraphNode<T>[];
  edges: GraphEdge<E>[];

  /** Optional ref to access imperative graph methods. */
  graphRef?: React.Ref<GraphCanvasRef>;
  /** Optional children rendered as an absolute overlay within the GraphCanvas context. */
  children?: ReactNode;
  /** Whether to show the built-in 'Fit view' floating button in the corner. (default: true) */
  showFitView?: boolean;
  /** Show the built-in minimap navigator in the bottom-left corner: a scaled
   *  mini-view of the whole graph with the current viewport as a draggable
   *  rectangle. (default: false) */
  showMinimap?: boolean;
  /** Expose the graph to keyboard and screen-reader users via a focusable
   *  semantic layer (arrow keys to traverse, Enter/Space to select, Alt+arrows
   *  to move, `c` then Enter to connect). (default: true) */
  keyboardNav?: boolean;
  /** Accessible name for a node. Defaults to `data.label`, falling back to id. */
  getNodeLabel?: (node: GraphNode<T>) => string;

  // ── Node customisation
  /** Radius of each node in graph-space pixels (default: 40).
   *  Used for collision, fit-to-view, and default circular edge anchors. */
  getNodeRadius?: (node: GraphNode<T>) => number;
  /** Bounding box of each node, used to place and hit-test ports
   *  (default: 96×96). Only consulted for nodes that declare ports.
   *
   *  This must equal the node's rendered **border-box**. Port positions, edge
   *  anchors and spatial hit-boxes are all derived from it, so a mismatch
   *  offsets every port by the difference. In practice that means giving the
   *  element `boxSizing: "border-box"` when it has a border, or the border
   *  width lands outside the size you reported here. */
  getNodeSize?: (node: GraphNode<T>) => NodeSize;
  /** Typed connection endpoints for a node. Returning ports here is what
   *  enables port-aware anchoring, snapping, validation, and rendering —
   *  nodes without ports keep the plain perimeter-anchor behaviour. */
  getNodePorts?: (node: GraphNode<T>) => PortDef[];
  /** Return the shape to use when drawing an unselected node on the Canvas layer.
   *  Defaults to "circle". "rectangle" also widens the node's hit-testing
   *  bounds to the drawn rectangle (unioned with the radius box), so clicks,
   *  drags and hover land on the whole painted shape without the radius
   *  needing to compensate. */
  getNodeShape?: (node: GraphNode<T>) => string;
  /** Override where edges attach to a node. Useful for non-circular shapes
   *  such as pills and rounded rectangles. */
  getNodeAnchor?: (props: NodeAnchorProps<T>) => NodePosition;
  /** Custom node content. Receives render props; must return a React element.
   *  The outer positioned wrapper is managed by the library. */
  renderNode?: (props: NodeRenderProps<T>) => ReactNode;
  /** When true, every node is rendered via `renderNode` in the HTML layer rather
   *  than only the selected node. Use for small graphs where all nodes need
   *  interactive DOM elements (e.g. multi-port connectors). (default: false) */
  renderAllNodes?: boolean;
  /** Custom Canvas 2D drawing for each unselected node. Return `true` to skip the default drawing. */
  renderCanvasNode?: (props: RenderCanvasNodeProps<T>) => boolean | void;
  /** Custom port visual for the HTML layer. Return `null` to hide a port.
   *  Defaults to a dot for `type: "main"` and a diamond for every other type.
   *  The positioned, drag-enabled wrapper is managed by the library. */
  renderPort?: (props: PortRenderProps<T>) => ReactNode | null;
  /** Custom Canvas 2D drawing for a port on an unselected node.
   *  Return `true` to skip the default drawing. */
  renderCanvasPort?: (props: RenderCanvasPortProps<T>) => boolean | void;
  /** Render a single managed context menu for the active right-click target. */
  renderContextMenu?: (props: GraphContextMenuProps<T, E>) => ReactNode | null;

  // ── Edge customisation
  /** Return stroke style for each edge. Merge with defaults. */
  getEdgeStyle?: (edge: GraphEdge<E>) => EdgeStyle;
  /** Text drawn at the midpoint of an edge. Return null for no label. */
  getEdgeLabel?: (edge: GraphEdge<E>) => string | null | undefined;
  /** Render a floating toolbar over the hovered edge (insert, delete, …).
   *  Appears after `edgeToolbarDelay` ms of hover. */
  renderEdgeToolbar?: (props: EdgeToolbarProps<T, E>) => ReactNode | null;
  /** Hover dwell before `renderEdgeToolbar` is shown (default: 600). */
  edgeToolbarDelay?: number;
  /** Return the route type for each edge (default: "straight"). */
  getEdgeRoute?: (props: EdgeRouteProps<T, E>) => EdgeRouteType;
  /** Return a scalar multiplier for curved and s-curved bend strength (default: 1). */
  getEdgeCurveStrength?: (props: EdgeRouteProps<T, E>) => number;
  /** Override bezier control points for curved and s-curved edges. */
  getEdgeControlPoints?: (
    props: EdgeControlPointProps<T, E>
  ) => EdgeControlPointOverride | null | undefined;

  // ── Layout
  /** Run D3 force simulation to position nodes that have no position (default: true) */
  layoutEnabled?: boolean;
  /** Preferred edge length in the force simulation (default: 140) */
  layoutLinkDistance?: number;
  /** Many-body charge strength — negative = repel (default: -400) */
  layoutChargeStrength?: number;

  // ── Initial / seed positions
  /** Positions to seed the engine with. Nodes missing from this map are
   *  auto-placed by the force layout.
   *
   *  Seed-only: this is applied to nodes that have no position yet, so
   *  changing it never moves nodes the engine or the user has already placed
   *  (which is what lets consumers feed `onPositionsChange` straight back in).
   *  To genuinely reset layout, remount the canvas with a new React `key`. */
  initialPositions?: Record<string, NodePosition>;

  // ── Connections
  /** Reject a proposed connection. Called continuously during a connect drag
   *  (so the preview line can show the verdict) and again before `onConnect`.
   *  Port cardinality (`maxConnections`) is enforced separately by the library. */
  isValidConnection?: (connection: ConnectionContext<T>) => boolean;
  /** Fires when a connect drag lands on a valid target. */
  onConnect?: (connection: Connection) => void;

  // ── Callbacks
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeClick?: (id: string, event: React.MouseEvent) => void;
  onNodeDoubleClick?: (id: string, event: React.MouseEvent) => void;
  /** Click on an edge in the Canvas renderer. */
  onEdgeClick?: (id: string, event: React.MouseEvent) => void;
  /** Fires when the hovered edge changes (null when the pointer leaves all edges). */
  onEdgeHover?: (id: string | null, event: React.PointerEvent | null) => void;
  /** Enter pressed on an edge in the accessibility layer. Edge selection is
   *  consumer-controlled (`selectedEdgeIds`), so this is how a keyboard user
   *  acts on an edge — wire it the way you wire `onEdgeClick`. */
  onEdgeActivate?: (id: string) => void;
  onCanvasDoubleClick?: (graphX: number, graphY: number) => void;
  /** Fired whenever internal positions change (useful for persistence) */
  onPositionsChange?: (positions: Record<string, NodePosition>) => void;

  // ── Selection (controlled)
  /** Controlled selection. If provided, the library does not manage its own. */
  selectedNodeIds?: string[];
  /** Fires when the store selection changes (both controlled and uncontrolled mode). */
  onSelectionChange?: (ids: string[]) => void;
  /** Edge ids to draw as selected. */
  selectedEdgeIds?: string[];
  /** Edge ids to draw with a highlight treatment. */
  highlightedEdgeIds?: string[];

  // ── Cross-graph linking (multiple GraphCanvas instances)
  /** Identity of this graph within a GraphLink group. Required to participate
   *  in cross-graph selection/hover highlighting and imperative peer calls. */
  linkId?: string;
  /** Explicit GraphLink. If omitted, the nearest <GraphLinkProvider> is used. */
  link?: GraphLink;
  /** Map a local node id to a shared cross-graph key (default: identity).
   *  Nodes sharing a key across graphs are linked for highlighting. */
  toLinkKey?: (id: string) => string | null;
  /** Extra node ids to render highlighted, unioned with any cross-graph
   *  highlight. Non-destructive — does not affect selection. */
  highlightedNodeIds?: string[];
  /** Fires when the hovered node changes (null when the pointer leaves all nodes). */
  onNodeHover?: (id: string | null, event: React.PointerEvent | null) => void;
  /** Allow a connector drag started here to drop onto another linked graph.
   *  Requires linkId + a GraphLink. (default: false) */
  crossGraphDrag?: boolean;
  /** Called when a node from another linked graph is dropped onto this one,
   *  with the drop point already mapped into this graph's coordinates. */
  onExternalDrop?: (payload: CrossDragPayload, graphX: number, graphY: number) => void;

  // ── Rendering config
  /** Enable rubber-band (marquee) selection by dragging on the blank canvas (default: false) */
  marqueeSelect?: boolean;
  /** Allow left-click drag to pan the canvas (default: false). Useful for chart-like views
   *  where nodes are not draggable. */
  panOnDrag?: boolean;
  /** Draw a background pattern behind the graph (default: false). */
  showBackground?: boolean | "dots" | "grid";
  /** Quantise node positions to a grid of this size in graph-space pixels
   *  while dragging and on keyboard nudges. Undefined disables snapping. */
  snapToGrid?: number;
  /** Show zoom-in / zoom-out buttons alongside the fit-view chrome (default: false). */
  showZoomControls?: boolean;

  className?: string;
  style?: CSSProperties;
}
