import type {
  BezierEdgeRouteType,
  EdgeBezierControlPoints,
  EdgeControlPointOverride,
  EdgeControlPointProps,
  EdgeRouteProps,
  EdgeRouteType,
  GraphEdge,
  GraphNode,
  NodeAnchorProps,
  NodePosition,
  NodeSize,
  PortDef,
  Viewport,
} from "./types.js";
import {
  findPort,
  getPortAnchor,
  getPortNormal,
  getPortSide,
  resolveNodeSize,
} from "./ports.js";
import { DEFAULT_NODE_RADIUS } from "./constants.js";

// Re-exported so existing importers keep a single obvious home for it.
export { DEFAULT_NODE_RADIUS } from "./constants.js";
export const DEFAULT_EDGE_ROUTE: EdgeRouteType = "straight";
export const EDGE_CONTROL_POINT_START = 0.35;
export const EDGE_CONTROL_POINT_END = 0.65;
export const EDGE_CURVE_BEND_RATIO = 0.28;
export const EDGE_CURVE_BEND_MIN = 24;
export const EDGE_CURVE_BEND_MAX = 120;
export const EDGE_S_CURVE_HANDLE_MIN = 24;
export const EDGE_S_CURVE_HANDLE_MAX = 120;
const CURVED_PICK_SEGMENTS = 12;
const DEFAULT_EDGE_CURVE_STRENGTH = 1;

export interface EdgeRouteGeometry {
  route: EdgeRouteType;
  path: string;
  pickPoints: NodePosition[];
  labelPosition: NodePosition;
  arrowBase: NodePosition;
  arrowTip: NodePosition;
  controlPoints?: EdgeBezierControlPoints;
  points?: NodePosition[];
}

export function getNodeRadius<T>(
  node: GraphNode<T>,
  getRadius?: (node: GraphNode<T>) => number
): number {
  const radius = getRadius ? getRadius(node) : DEFAULT_NODE_RADIUS;
  // Radius feeds canvas arc(), edge anchors, the spatial index and fit bounds.
  // One malformed callback value must not poison those independent consumers.
  return Number.isFinite(radius) && radius >= 0 ? radius : DEFAULT_NODE_RADIUS;
}

/**
 * Resolve the shape an unselected node is drawn with on the Canvas layer:
 * the `getNodeShape` prop, then a `shape` string on the node's data, then
 * "circle". Shared by the canvas renderer and the spatial index, so the box
 * that is hit-tested is derived from the same shape that is painted.
 */
export function resolveNodeShape<T>(
  node: GraphNode<T>,
  getNodeShape?: (node: GraphNode<T>) => string
): string {
  const fromProp = getNodeShape?.(node);
  if (fromProp) return fromProp;
  const data = node.data as Record<string, unknown> | null;
  const fromData = data && typeof data === "object" ? data.shape : undefined;
  return typeof fromData === "string" && fromData ? fromData : "circle";
}

/** Returns the point on the perimeter of `from` that faces `to`. */
export function getAnchorPoint(
  from: NodePosition,
  to: NodePosition,
  radius: number
): NodePosition {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    x: from.x + (dx / dist) * radius,
    y: from.y + (dy / dist) * radius,
  };
}

/** Optional port lookup passed down from GraphCanvas so anchors can resolve to
 *  an exact port position rather than the node perimeter. */
export interface PortAnchorResolver<T> {
  getNodePorts: (node: GraphNode<T>) => PortDef[];
  getNodeSize?: (node: GraphNode<T>) => NodeSize;
}

/**
 * Where an edge attaches to a node.
 *
 * Resolution order:
 *   1. the port registry, when the edge names a port that the node declares
 *   2. the consumer's `getNodeAnchor` override
 *   3. the circular perimeter derived from the node radius
 *
 * Ports win over the override because a named port is a more specific
 * statement of intent than a whole-node anchor rule.
 */
export function getNodeAnchor<T>(
  node: GraphNode<T>,
  position: NodePosition,
  target: NodePosition,
  getRadius?: (node: GraphNode<T>) => number,
  getCustomAnchor?: (props: NodeAnchorProps<T>) => NodePosition,
  portId?: string,
  portResolver?: PortAnchorResolver<T>
): NodePosition {
  if (portId && portResolver) {
    const ports = portResolver.getNodePorts(node);
    if (ports.length > 0) {
      const size = resolveNodeSize(node, portResolver.getNodeSize);
      // The port's outer tip, not its centre — see getPortAnchor.
      const portAnchor = getPortAnchor(position, size, ports, portId);
      if (portAnchor) return portAnchor;
    }
  }
  if (getCustomAnchor) {
    return getCustomAnchor({ node, position, target, portId });
  }
  return getAnchorPoint(position, target, getNodeRadius(node, getRadius));
}

function lerpPoint(a: NodePosition, b: NodePosition, t: number): NodePosition {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function buildPolylinePath(points: NodePosition[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function getAngledEdgePoints(
  source: NodePosition,
  target: NodePosition
): NodePosition[] {
  const dx = Math.abs(target.x - source.x);
  const dy = Math.abs(target.y - source.y);

  if (dx >= dy) {
    const midX = source.x + (target.x - source.x) / 2;
    return [
      source,
      { x: midX, y: source.y },
      { x: midX, y: target.y },
      target,
    ];
  }

  const midY = source.y + (target.y - source.y) / 2;
  return [
    source,
    { x: source.x, y: midY },
    { x: target.x, y: midY },
    target,
  ];
}

function pointAlongPolyline(points: NodePosition[], t: number): NodePosition {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return points[0];
  }

  const clampedT = Math.max(0, Math.min(1, t));
  let totalLength = 0;
  const lengths: number[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y
    );
    lengths.push(length);
    totalLength += length;
  }

  if (totalLength === 0) {
    return points[0];
  }

  let targetDistance = totalLength * clampedT;

  for (let i = 0; i < lengths.length; i++) {
    if (targetDistance <= lengths[i]) {
      const segmentT = lengths[i] === 0 ? 0 : targetDistance / lengths[i];
      return lerpPoint(points[i], points[i + 1], segmentT);
    }
    targetDistance -= lengths[i];
  }

  return points[points.length - 1];
}

export function resolveEdgeRouteType<T, E>(
  edge: GraphEdge<E> | undefined,
  sourceNode: GraphNode<T>,
  targetNode: GraphNode<T> | undefined,
  source: NodePosition,
  target: NodePosition,
  phase: "edge" | "preview",
  getCustomRoute?: (props: EdgeRouteProps<T, E>) => EdgeRouteType
): EdgeRouteType {
  if (!getCustomRoute) {
    return DEFAULT_EDGE_ROUTE;
  }

  return getCustomRoute({
    edge,
    sourceNode,
    targetNode,
    source,
    target,
    phase,
  });
}

export function resolveEdgeCurveStrength<T, E>(
  edge: GraphEdge<E> | undefined,
  sourceNode: GraphNode<T>,
  targetNode: GraphNode<T> | undefined,
  source: NodePosition,
  target: NodePosition,
  phase: "edge" | "preview",
  getCustomCurveStrength?: (props: EdgeRouteProps<T, E>) => number
): number {
  if (!getCustomCurveStrength) {
    return DEFAULT_EDGE_CURVE_STRENGTH;
  }

  const value = getCustomCurveStrength({
    edge,
    sourceNode,
    targetNode,
    source,
    target,
    phase,
  });

  if (!Number.isFinite(value)) {
    return DEFAULT_EDGE_CURVE_STRENGTH;
  }

  return Math.max(0, value);
}

/** Returns source and target anchor points for an edge. Defaults to circular
 *  anchors derived from node radius, but can be overridden per node shape.
 *  When sourcePort/targetPort are supplied, they are forwarded to getCustomAnchor
 *  so consumers can return the exact port position instead of the node perimeter. */
export function getEdgeAnchors<T>(
  sourceNode: GraphNode<T>,
  targetNode: GraphNode<T>,
  positions: Record<string, NodePosition>,
  getRadius?: (node: GraphNode<T>) => number,
  getCustomAnchor?: (props: NodeAnchorProps<T>) => NodePosition,
  sourcePort?: string,
  targetPort?: string,
  portResolver?: PortAnchorResolver<T>
): EdgeAnchors | null {
  const sp = positions[sourceNode.id];
  const tp = positions[targetNode.id];
  if (!sp || !tp) return null;
  return {
    source: getNodeAnchor(sourceNode, sp, tp, getRadius, getCustomAnchor, sourcePort, portResolver),
    target: getNodeAnchor(targetNode, tp, sp, getRadius, getCustomAnchor, targetPort, portResolver),
    // Reported so bezier routes can leave and enter perpendicular to the node
    // edge the port sits on. Undefined for non-port endpoints.
    sourceNormal: resolvePortNormal(sourceNode, sourcePort, portResolver),
    targetNormal: resolvePortNormal(targetNode, targetPort, portResolver),
  };
}

export interface EdgeAnchors {
  source: NodePosition;
  target: NodePosition;
  sourceNormal?: NodePosition;
  targetNormal?: NodePosition;
}

/** The outward normal of a node's port, when the endpoint names one. */
export function resolvePortNormal<T>(
  node: GraphNode<T>,
  portId: string | undefined,
  portResolver?: PortAnchorResolver<T>
): NodePosition | undefined {
  if (!portId || !portResolver) return undefined;
  const port = findPort(portResolver.getNodePorts(node), portId);
  return port ? getPortNormal(getPortSide(port)) : undefined;
}

export function isBezierEdgeRoute(route: EdgeRouteType): route is BezierEdgeRouteType {
  return route === "curved" || route === "s-curved";
}

function getCurvedEdgeControlPoints(
  source: NodePosition,
  target: NodePosition,
  curveStrength: number = DEFAULT_EDGE_CURVE_STRENGTH
): EdgeBezierControlPoints {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const effectiveStrength = Math.max(0, curveStrength);
  const bend = Math.min(
    EDGE_CURVE_BEND_MAX * effectiveStrength,
    Math.max(
      EDGE_CURVE_BEND_MIN * effectiveStrength,
      dist * EDGE_CURVE_BEND_RATIO * effectiveStrength
    )
  );

  return {
    c1: {
      x: source.x + dx * EDGE_CONTROL_POINT_START + nx * bend,
      y: source.y + dy * EDGE_CONTROL_POINT_START + ny * bend,
    },
    c2: {
      x: source.x + dx * EDGE_CONTROL_POINT_END + nx * bend,
      y: source.y + dy * EDGE_CONTROL_POINT_END + ny * bend,
    },
  };
}

function getSCurvedEdgeControlPoints(
  source: NodePosition,
  target: NodePosition,
  curveStrength: number = DEFAULT_EDGE_CURVE_STRENGTH,
  sourceNormal?: NodePosition,
  targetNormal?: NodePosition
): EdgeBezierControlPoints {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const effectiveStrength = Math.max(0, curveStrength);

  // When the endpoints are ports, leave and enter along the port's own outward
  // normal. This is what gives typed sub-connections their shape: an edge from
  // a node's bottom port drops straight down before curving away, instead of
  // shooting sideways and arcing back over the node.
  //
  // Inferring direction from the dominant axis isn't enough — a provider placed
  // well to one side makes the horizontal span the larger one, so the edge
  // would leave sideways out of a bottom port.
  if (sourceNormal || targetNormal) {
    const distance = Math.hypot(dx, dy) || 1;
    const handle = Math.min(
      EDGE_S_CURVE_HANDLE_MAX * effectiveStrength,
      Math.max(
        EDGE_S_CURVE_HANDLE_MIN * effectiveStrength,
        distance * EDGE_CONTROL_POINT_START * effectiveStrength
      )
    );
    return {
      c1: sourceNormal
        ? { x: source.x + sourceNormal.x * handle, y: source.y + sourceNormal.y * handle }
        : { x: source.x + Math.sign(dx || 1) * handle, y: source.y },
      c2: targetNormal
        ? { x: target.x + targetNormal.x * handle, y: target.y + targetNormal.y * handle }
        : { x: target.x - Math.sign(dx || 1) * handle, y: target.y },
    };
  }

  // Leave and enter along whichever axis the edge actually travels.
  //
  // Handles were previously always horizontal, which reads correctly for a
  // left-to-right flow but collapses a near-vertical edge to a straight line:
  // the handles are clamped against the *horizontal* span, which is ~0 there,
  // so no amount of curveStrength can bend it. Port-to-port edges on the top
  // and bottom edges of a node are exactly that case.
  const vertical = Math.abs(dy) > Math.abs(dx);
  const span = Math.abs(vertical ? dy : dx);
  const direction = (vertical ? dy : dx) < 0 ? -1 : 1;

  // Never let a handle reach past the midpoint, or the two cross and the curve
  // doubles back on itself.
  const maxBend = Math.max(span / 2, EDGE_S_CURVE_HANDLE_MIN);
  const startDistance = Math.min(
    EDGE_S_CURVE_HANDLE_MAX * effectiveStrength,
    Math.max(
      EDGE_S_CURVE_HANDLE_MIN * effectiveStrength,
      span * EDGE_CONTROL_POINT_START * effectiveStrength
    )
  );
  const endDistance = Math.min(
    EDGE_S_CURVE_HANDLE_MAX * effectiveStrength,
    Math.max(
      EDGE_S_CURVE_HANDLE_MIN * effectiveStrength,
      span * (1 - EDGE_CONTROL_POINT_END) * effectiveStrength
    )
  );
  const clampedStartDistance = Math.min(startDistance, maxBend);
  const clampedEndDistance = Math.min(endDistance, maxBend);

  return vertical
    ? {
        c1: { x: source.x, y: source.y + direction * clampedStartDistance },
        c2: { x: target.x, y: target.y - direction * clampedEndDistance },
      }
    : {
        c1: { x: source.x + direction * clampedStartDistance, y: source.y },
        c2: { x: target.x - direction * clampedEndDistance, y: target.y },
      };
}

/** Returns cubic bezier control points for the requested bezier route type.
 *  `curved` uses a bowed perpendicular offset; `s-curved` leaves and enters
 *  horizontally so left-to-right edges read as an S-curve. */
export function getEdgeControlPoints(
  source: NodePosition,
  target: NodePosition,
  curveStrength: number = DEFAULT_EDGE_CURVE_STRENGTH,
  route: BezierEdgeRouteType = "curved",
  sourceNormal?: NodePosition,
  targetNormal?: NodePosition
): EdgeBezierControlPoints {
  if (route === "s-curved") {
    return getSCurvedEdgeControlPoints(source, target, curveStrength, sourceNormal, targetNormal);
  }

  return getCurvedEdgeControlPoints(source, target, curveStrength);
}

function isValidNodePosition(position: NodePosition | undefined): position is NodePosition {
  return Boolean(
    position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y)
  );
}

export function resolveEdgeControlPoints<T, E>(
  edge: GraphEdge<E> | undefined,
  sourceNode: GraphNode<T>,
  targetNode: GraphNode<T> | undefined,
  source: NodePosition,
  target: NodePosition,
  phase: "edge" | "preview",
  route: EdgeRouteType,
  curveStrength: number,
  getCustomControlPoints?: (
    props: EdgeControlPointProps<T, E>
  ) => EdgeControlPointOverride | null | undefined,
  sourceNormal?: NodePosition,
  targetNormal?: NodePosition
): EdgeBezierControlPoints | undefined {
  if (!isBezierEdgeRoute(route)) {
    return undefined;
  }

  const defaultControlPoints = getEdgeControlPoints(
    source,
    target,
    curveStrength,
    route,
    sourceNormal,
    targetNormal
  );

  if (!getCustomControlPoints) {
    return defaultControlPoints;
  }

  const override = getCustomControlPoints({
    edge,
    sourceNode,
    targetNode,
    source,
    target,
    phase,
    route,
    curveStrength,
    defaultControlPoints,
  });

  if (!override) {
    return defaultControlPoints;
  }

  return {
    c1: isValidNodePosition(override.c1)
      ? override.c1
      : defaultControlPoints.c1,
    c2: isValidNodePosition(override.c2)
      ? override.c2
      : defaultControlPoints.c2,
  };
}

export function getEdgeRouteGeometry(
  source: NodePosition,
  target: NodePosition,
  route: EdgeRouteType = DEFAULT_EDGE_ROUTE,
  curveStrength: number = DEFAULT_EDGE_CURVE_STRENGTH,
  controlPoints?: EdgeBezierControlPoints
): EdgeRouteGeometry {
  if (route === "straight") {
    const points = [source, target];
    return {
      route,
      path: buildPolylinePath(points),
      pickPoints: points,
      labelPosition: lerpPoint(source, target, 0.5),
      arrowBase: source,
      arrowTip: target,
      points,
    };
  }

  if (route === "angled") {
    const points = getAngledEdgePoints(source, target);
    return {
      route,
      path: buildPolylinePath(points),
      pickPoints: points,
      labelPosition: pointAlongPolyline(points, 0.5),
      arrowBase: points[points.length - 2],
      arrowTip: target,
      points,
    };
  }

  const resolvedControlPoints =
    controlPoints ??
    getEdgeControlPoints(
      source,
      target,
      curveStrength,
      route === "s-curved" ? "s-curved" : "curved"
    );
  const { c1, c2 } = resolvedControlPoints;
  const pickPoints = Array.from({ length: CURVED_PICK_SEGMENTS + 1 }, (_, index) =>
    bezierPoint(source, c1, c2, target, index / CURVED_PICK_SEGMENTS)
  );

  return {
    route,
    path: `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,
    pickPoints,
    labelPosition: bezierPoint(source, c1, c2, target, 0.5),
    arrowBase: c2,
    arrowTip: target,
    controlPoints: { c1, c2 },
  };
}

/** Cubic bezier SVG path string between two points.
 *  The default route is the standard bowed `curved` bezier. */
export function buildEdgePath(source: NodePosition, target: NodePosition): string {
  return getEdgeRouteGeometry(source, target, "curved").path;
}

/** Evaluate a cubic bezier at parameter t ∈ [0, 1]. */
export function bezierPoint(
  p0: NodePosition,
  p1: NodePosition,
  p2: NodePosition,
  p3: NodePosition,
  t: number
): NodePosition {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}

/** Axis-aligned rectangle in graph space. */
export interface GraphRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The slice of graph space currently visible in a container of `width`x`height`
 * screen pixels under `viewport`. Used by the canvas layers for viewport
 * culling and by the minimap to draw the viewport indicator, so all three stay
 * in agreement about what "on screen" means.
 */
export function getVisibleGraphRect(
  viewport: Viewport,
  width: number,
  height: number
): GraphRect {
  const zoom = viewport.zoom;
  const minX = -viewport.x / zoom;
  const minY = -viewport.y / zoom;
  return {
    minX,
    minY,
    maxX: minX + width / zoom,
    maxY: minY + height / zoom,
  };
}
