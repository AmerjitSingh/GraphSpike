"use client";

import { memo, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import RBush from "rbush";
import type {
  EdgeControlPointOverride,
  EdgeControlPointProps,
  EdgeRouteType,
  EdgeRouteProps,
  EdgeStyle,
  GraphEdge,
  GraphNode,
  NodePosition,
  Viewport,
} from "../types.js";
import {
  getEdgeAnchors,
  getEdgeRouteGeometry,
  getVisibleGraphRect,
  type EdgeRouteGeometry,
  type PortAnchorResolver,
  resolveEdgeControlPoints,
  resolveEdgeCurveStrength,
  resolveEdgeRouteType,
} from "../geometry.js";
import { findPort, getPortExtent } from "../ports.js";

// ─── Geometry cache ───────────────────────────────────────────────────────────

const PICK_TOLERANCE_PX = 10; // screen-space tolerance in pixels

type EdgeGeometry<E> = {
  id: string;
  edge: GraphEdge<E>;
  routeGeometry: EdgeRouteGeometry;
  pickPoints: NodePosition[]; // polyline approximation for hit-testing
  /** How far past its centre the target port's glyph reaches, in graph units.
   *  Zero when the edge doesn't terminate on a port. See the arrowhead code. */
  targetPortExtent: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function buildGeometry<T, E>(
  edge: GraphEdge<E>,
  nodeById: Map<string, GraphNode<T>>,
  positions: Record<string, NodePosition>,
  getNodeRadius: (node: GraphNode<T>) => number,
  getNodeAnchor?: (props: {
    node: GraphNode<T>;
    position: NodePosition;
    target: NodePosition;
    portId?: string;
  }) => NodePosition,
  getEdgeRoute?: (props: EdgeRouteProps<T, E>) => EdgeRouteType,
  getEdgeCurveStrength?: (props: EdgeRouteProps<T, E>) => number,
  getEdgeControlPoints?: (
    props: EdgeControlPointProps<T, E>
  ) => EdgeControlPointOverride | null | undefined,
  portResolver?: PortAnchorResolver<T>
): EdgeGeometry<E> | null {
  const src = nodeById.get(edge.source);
  const tgt = nodeById.get(edge.target);
  if (!src || !tgt) return null;

  const anchors = getEdgeAnchors(
    src, tgt, positions, getNodeRadius, getNodeAnchor,
    edge.sourcePort, edge.targetPort, portResolver
  );
  if (!anchors) return null;

  const route = resolveEdgeRouteType(
    edge,
    src,
    tgt,
    anchors.source,
    anchors.target,
    "edge",
    getEdgeRoute
  );
  const curveStrength = resolveEdgeCurveStrength(
    edge,
    src,
    tgt,
    anchors.source,
    anchors.target,
    "edge",
    getEdgeCurveStrength
  );
  const controlPoints = resolveEdgeControlPoints(
    edge,
    src,
    tgt,
    anchors.source,
    anchors.target,
    "edge",
    route,
    curveStrength,
    getEdgeControlPoints,
    anchors.sourceNormal,
    anchors.targetNormal
  );
  const routeGeometry = getEdgeRouteGeometry(
    anchors.source,
    anchors.target,
    route,
    curveStrength,
    controlPoints
  );

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of routeGeometry.pickPoints) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }

  // Resolved here rather than at draw time so it is captured by the same cache
  // entry as the anchors it belongs to — the two must always describe the same
  // port, or the arrowhead is positioned against a glyph that isn't there.
  const targetPortDef =
    edge.targetPort && portResolver
      ? findPort(portResolver.getNodePorts(tgt), edge.targetPort)
      : undefined;

  return {
    id: edge.id,
    edge,
    routeGeometry,
    pickPoints: routeGeometry.pickPoints,
    targetPortExtent: targetPortDef ? getPortExtent(targetPortDef) : 0,
    minX, minY, maxX, maxY,
  };
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

function distToSegSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 < 0.000001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const cx = ax + t * abx, cy = ay + t * aby;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function distToPolylineSq(px: number, py: number, pts: NodePosition[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegSq(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
  }
  return best;
}

// ─── Dash array helpers ───────────────────────────────────────────────────────

function parseDash(dash: string | undefined, zoom: number): number[] {
  if (!dash) return [];
  const scale = Math.max(zoom, 0.4);
  // SVG's stroke-dasharray grammar allows commas, whitespace, or both — "5,6",
  // "5 6" and "5, 6" are all legal and all common. Splitting on spaces alone
  // turns "5,6" into the single token "5,6", which parses to NaN, gets filtered
  // out, and silently renders a solid line.
  return dash
    .split(/[\s,]+/)
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => v * scale);
}

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_STYLE: Required<EdgeStyle> = {
  stroke: "#94a3b8",
  strokeWidth: 1.75,
  strokeDasharray: "",
  markerEnd: true,
};

/** Edge labels knock out the line behind them so the text stays readable. */
const EDGE_LABEL_COLOR = "#cbd5e1";
const EDGE_LABEL_BACKGROUND = "rgba(15, 23, 42, 0.85)";

interface EdgeCanvasLayerProps<T, E> {
  edges: GraphEdge<E>[];
  nodeById: Map<string, GraphNode<T>>;
  positions: Record<string, NodePosition>;
  viewport: Viewport;
  width: number;
  height: number;
  getNodeRadius: (node: GraphNode<T>) => number;
  getNodeAnchor?: (props: {
    node: GraphNode<T>;
    position: NodePosition;
    target: NodePosition;
  }) => NodePosition;
  getEdgeStyle?: (edge: GraphEdge<E>) => EdgeStyle;
  getEdgeRoute?: (props: EdgeRouteProps<T, E>) => EdgeRouteType;
  getEdgeCurveStrength?: (props: EdgeRouteProps<T, E>) => number;
  getEdgeControlPoints?: (
    props: EdgeControlPointProps<T, E>
  ) => EdgeControlPointOverride | null | undefined;
  selectedEdgeId?: string | null;
  selectedEdgeIds?: Set<string>;
  highlightedEdgeIds?: Set<string>;
  /** Text drawn at each edge's midpoint. */
  getEdgeLabel?: (edge: GraphEdge<E>) => string | null | undefined;
  /** Port lookup so edge anchors land on exact port positions. */
  portResolver?: PortAnchorResolver<T>;
  onEdgeClick?: (id: string, event: React.MouseEvent) => void;
  onEdgeContextMenu?: (id: string, event: React.MouseEvent) => void;
  onEdgeHover?: (id: string | null, event: React.PointerEvent | null) => void;
  interactive?: boolean;
}

export const EdgeCanvasLayer = memo(function EdgeCanvasLayer<T, E>({
  edges,
  nodeById,
  positions,
  viewport,
  width,
  height,
  getNodeRadius,
  getNodeAnchor,
  getEdgeStyle,
  getEdgeRoute,
  getEdgeCurveStrength,
  getEdgeControlPoints,
  selectedEdgeId,
  selectedEdgeIds,
  highlightedEdgeIds,
  getEdgeLabel,
  portResolver,
  onEdgeClick,
  onEdgeContextMenu,
  onEdgeHover,
  interactive = true,
}: EdgeCanvasLayerProps<T, E>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Snapshot the latest style callback so the draw effect reads a consistent
  // function during paint, while still rerendering when the callback identity
  // itself changes.
  const getEdgeStyleRef = useRef(getEdgeStyle);
  getEdgeStyleRef.current = getEdgeStyle;
  const getEdgeLabelRef = useRef(getEdgeLabel);
  getEdgeLabelRef.current = getEdgeLabel;

  // Last edge reported to `onEdgeHover`, so the callback only fires on change.
  const hoveredEdgeRef = useRef<string | null>(null);

  // Drop a stale hover when the hovered edge disappears (mirrors the node-
  // hover cleanup in GraphCanvas) — with the pointer stationary no pointermove
  // fires, so without this `onEdgeHover(null)` would never be delivered.
  useEffect(() => {
    const id = hoveredEdgeRef.current;
    if (id === null) return;
    if (!onEdgeHover) {
      hoveredEdgeRef.current = null;
      return;
    }
    if (!edges.some((edge) => edge.id === id)) {
      hoveredEdgeRef.current = null;
      onEdgeHover(null, null);
    }
  }, [edges, onEdgeHover]);

  // Incremental geometry cache — only rebuild an edge when its source/target
  // position changed or when a style-producing function identity changed.
  //
  // This useMemo mutates cacheRef. That's safe under Strict Mode because the
  // mutation is idempotent: a second invocation finds every edge already
  // cached (with matching src/tgt coords) and returns the same geometries.
  const cacheRef = useRef<{
    map: Map<
      string,
      { geom: EdgeGeometry<E>; edge: GraphEdge<E>; srcX: number; srcY: number; tgtX: number; tgtY: number }
    >;
    tree: RBush<EdgeGeometry<E>>;
    deps: {
      nodeById: typeof nodeById;
      getNodeRadius: typeof getNodeRadius;
      getNodeAnchor: typeof getNodeAnchor;
      getEdgeRoute: typeof getEdgeRoute;
      getEdgeCurveStrength: typeof getEdgeCurveStrength;
      getEdgeControlPoints: typeof getEdgeControlPoints;
      portResolver: typeof portResolver;
    } | null;
  }>({ map: new Map(), tree: new RBush(), deps: null });

  const { geometries, edgeIndex } = useMemo(() => {
    const cache = cacheRef.current;
    const prevDeps = cache.deps;
    const depsChanged =
      !prevDeps ||
      prevDeps.nodeById !== nodeById ||
      prevDeps.getNodeRadius !== getNodeRadius ||
      prevDeps.getNodeAnchor !== getNodeAnchor ||
      prevDeps.getEdgeRoute !== getEdgeRoute ||
      prevDeps.getEdgeCurveStrength !== getEdgeCurveStrength ||
      prevDeps.getEdgeControlPoints !== getEdgeControlPoints ||
      // A different port registry moves every port-anchored endpoint.
      prevDeps.portResolver !== portResolver;

    if (depsChanged) {
      cache.map.clear();
      cache.tree.clear();
    }
    cache.deps = {
      nodeById,
      getNodeRadius,
      getNodeAnchor,
      getEdgeRoute,
      getEdgeCurveStrength,
      getEdgeControlPoints,
      portResolver,
    };

    const seen = new Set<string>();
    const result: EdgeGeometry<E>[] = [];
    const toInsert: EdgeGeometry<E>[] = [];
    const toRemove: EdgeGeometry<E>[] = [];

    for (const edge of edges) {
      seen.add(edge.id);
      const sp = positions[edge.source];
      const tp = positions[edge.target];
      const cached = cache.map.get(edge.id);
      if (
        cached &&
        sp &&
        tp &&
        // Identity matters as much as position: an edge replaced with new data
        // under the same id feeds different results out of getEdgeRoute /
        // getEdgeCurveStrength / getEdgeControlPoints, and the cached geometry
        // also carries the stale edge object on to getEdgeStyle at draw time.
        cached.edge === edge &&
        cached.srcX === sp.x &&
        cached.srcY === sp.y &&
        cached.tgtX === tp.x &&
        cached.tgtY === tp.y
      ) {
        result.push(cached.geom);
        continue;
      }

      if (cached) toRemove.push(cached.geom);

      const g = buildGeometry(
        edge,
        nodeById,
        positions,
        getNodeRadius,
        getNodeAnchor,
        getEdgeRoute,
        getEdgeCurveStrength,
        getEdgeControlPoints,
        portResolver
      );
      if (!g) {
        cache.map.delete(edge.id);
        continue;
      }
      cache.map.set(edge.id, {
        geom: g,
        edge,
        srcX: sp?.x ?? NaN,
        srcY: sp?.y ?? NaN,
        tgtX: tp?.x ?? NaN,
        tgtY: tp?.y ?? NaN,
      });
      result.push(g);
      toInsert.push(g);
    }

    // Drop cache entries for edges that no longer exist.
    for (const id of cache.map.keys()) {
      if (!seen.has(id)) {
        toRemove.push(cache.map.get(id)!.geom);
        cache.map.delete(id);
      }
    }

    // Update the persistent spatial index incrementally instead of rebuilding
    // from scratch every frame. When deps changed we already cleared the tree,
    // so bulk-load is faster; otherwise remove stale entries then insert new ones.
    if (depsChanged) {
      if (result.length > 0) cache.tree.load(result);
    } else {
      for (const g of toRemove) cache.tree.remove(g);
      for (const g of toInsert) cache.tree.insert(g);
    }

    return { geometries: result, edgeIndex: cache.tree };
  }, [
    edges,
    nodeById,
    positions,
    getNodeRadius,
    getNodeAnchor,
    getEdgeRoute,
    getEdgeCurveStrength,
    getEdgeControlPoints,
    portResolver,
  ]);

  // Hit test: return the closest edge geometry under a client point.
  const hitTest = useCallback(
    (clientX: number, clientY: number): EdgeGeometry<E> | null => {
      const canvas = canvasRef.current;
      if (!canvas || !interactive || geometries.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const gx = (clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (clientY - rect.top - viewport.y) / viewport.zoom;
      const tol = PICK_TOLERANCE_PX / Math.max(viewport.zoom, 0.3);
      const tolSq = tol * tol;

      const searchBox = {
        minX: gx - tol,
        minY: gy - tol,
        maxX: gx + tol,
        maxY: gy + tol,
      };

      const candidates = edgeIndex.search(searchBox);

      let best: EdgeGeometry<E> | null = null;
      let bestDist = Infinity;

      for (const g of candidates) {
        const d = distToPolylineSq(gx, gy, g.pickPoints);
        if (d <= tolSq && d < bestDist) { best = g; bestDist = d; }
      }
      return best;
    },
    [edgeIndex, interactive, viewport, geometries]
  );

  // Draw all edges onto the canvas whenever geometry or viewport changes.
  // useLayoutEffect (not useEffect) ensures the canvas is redrawn in the same
  // synchronous commit as the node-div CSS transform updates — before the
  // browser paints — so edges and nodes never appear out of sync during drag.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const tw = Math.max(1, Math.floor(width * dpr));
    const th = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== tw) canvas.width = tw;
    if (canvas.height !== th) canvas.height = th;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const zs = Math.max(viewport.zoom, 0.3);

    // Viewport culling: skip edges whose graph-space bbox doesn't intersect the
    // visible rect. Each geometry's bbox is consistent with `positions` since
    // both come from the same memo. The margin covers half the stroke width,
    // which is a screen-space size and so grows in graph units as zoom falls.
    const view = getVisibleGraphRect(viewport, width, height);
    const edgeCullMargin = 8 + 4 / Math.max(viewport.zoom, 0.001);

    const getEdgeStyleLatest = getEdgeStyleRef.current;
    const getEdgeLabelLatest = getEdgeLabelRef.current;
    for (const g of geometries) {
      if (
        g.maxX < view.minX - edgeCullMargin || g.minX > view.maxX + edgeCullMargin ||
        g.maxY < view.minY - edgeCullMargin || g.minY > view.maxY + edgeCullMargin
      ) continue;

      const routeGeometry = g.routeGeometry;
      const custom = getEdgeStyleLatest?.(g.edge) ?? {};
      const stroke = custom.stroke ?? DEFAULT_STYLE.stroke;
      const baseWidth = custom.strokeWidth ?? DEFAULT_STYLE.strokeWidth;
      const dashArr = custom.strokeDasharray ?? DEFAULT_STYLE.strokeDasharray;

      const isSelected = selectedEdgeId === g.id || selectedEdgeIds?.has(g.id) === true;
      const isHighlighted = highlightedEdgeIds?.has(g.id);
      const lineWidth = Math.max(0.8, baseWidth * zs * (isSelected || isHighlighted ? 2 : 1));

      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(parseDash(dashArr, zs));
      ctx.beginPath();

      if (routeGeometry.controlPoints) {
        const startPoint = routeGeometry.pickPoints[0];
        const sx0 = startPoint.x * viewport.zoom + viewport.x;
        const sy0 = startPoint.y * viewport.zoom + viewport.y;
        const sx1 = routeGeometry.controlPoints.c1.x * viewport.zoom + viewport.x;
        const sy1 = routeGeometry.controlPoints.c1.y * viewport.zoom + viewport.y;
        const sx2 = routeGeometry.controlPoints.c2.x * viewport.zoom + viewport.x;
        const sy2 = routeGeometry.controlPoints.c2.y * viewport.zoom + viewport.y;
        const sx3 = routeGeometry.arrowTip.x * viewport.zoom + viewport.x;
        const sy3 = routeGeometry.arrowTip.y * viewport.zoom + viewport.y;
        ctx.moveTo(sx0, sy0);
        ctx.bezierCurveTo(sx1, sy1, sx2, sy2, sx3, sy3);
      } else if (routeGeometry.points && routeGeometry.points.length > 0) {
        const [firstPoint, ...restPoints] = routeGeometry.points;
        ctx.moveTo(
          firstPoint.x * viewport.zoom + viewport.x,
          firstPoint.y * viewport.zoom + viewport.y
        );
        for (const point of restPoints) {
          ctx.lineTo(
            point.x * viewport.zoom + viewport.x,
            point.y * viewport.zoom + viewport.y
          );
        }
      }

      ctx.stroke();

      // Manual arrowhead (Canvas has no <marker> support).
      const showArrow = custom.markerEnd ?? DEFAULT_STYLE.markerEnd;
      if (showArrow && viewport.zoom > 0.25) {
        const arrowSize = Math.max(4, 7 * zs);
        const arrowBaseX = routeGeometry.arrowBase.x * viewport.zoom + viewport.x;
        const arrowBaseY = routeGeometry.arrowBase.y * viewport.zoom + viewport.y;
        const tx0 = routeGeometry.arrowTip.x - routeGeometry.arrowBase.x;
        const ty0 = routeGeometry.arrowTip.y - routeGeometry.arrowBase.y;
        const len0 = Math.hypot(tx0, ty0) || 1;

        // Bury the apex inside the target glyph rather than stopping on its
        // outer face. A sharp point meeting a glyph edge leaves background-
        // coloured slivers either side, so the arrow reads as falling short even
        // when it mathematically touches. Both node layers paint above this
        // canvas and port glyphs are opaque, so anything buried is occluded and
        // the glyph's own silhouette becomes the visible junction — flush by
        // construction, at any zoom and for any glyph shape.
        //
        // The glyph extent buries it at most to the port's centre. The arrow
        // half-length keeps at least half the head visible, which is what a
        // fixed fraction got wrong on the large diamond glyphs: a tuck big
        // enough to close the gap on a circle swallowed the point entirely.
        const arrowSizeGraph = arrowSize / viewport.zoom;
        const overlap = Math.min(g.targetPortExtent, arrowSizeGraph / 2);
        const arrowTipX =
          (routeGeometry.arrowTip.x + (tx0 / len0) * overlap) * viewport.zoom + viewport.x;
        const arrowTipY =
          (routeGeometry.arrowTip.y + (ty0 / len0) * overlap) * viewport.zoom + viewport.y;

        const tx = arrowTipX - arrowBaseX, ty = arrowTipY - arrowBaseY;
        const tlen = Math.hypot(tx, ty) || 1;
        const nx = tx / tlen, ny = ty / tlen;
        ctx.setLineDash([]);
        ctx.fillStyle = stroke;
        ctx.beginPath();
        ctx.moveTo(arrowTipX, arrowTipY);
        ctx.lineTo(
          arrowTipX - nx * arrowSize - ny * arrowSize * 0.5,
          arrowTipY - ny * arrowSize + nx * arrowSize * 0.5
        );
        ctx.lineTo(
          arrowTipX - nx * arrowSize + ny * arrowSize * 0.5,
          arrowTipY - ny * arrowSize - nx * arrowSize * 0.5
        );
        ctx.closePath();
        ctx.fill();
      }

      // Label at the route midpoint. `labelPosition` is computed for every
      // route type in geometry.ts, so this works for curves and elbows alike.
      const label = getEdgeLabelLatest?.(g.edge);
      if (label && viewport.zoom > 0.3) {
        const lx = routeGeometry.labelPosition.x * viewport.zoom + viewport.x;
        const ly = routeGeometry.labelPosition.y * viewport.zoom + viewport.y;
        ctx.setLineDash([]);
        ctx.font = `${11 * zs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Knock out the line behind the text so it stays readable.
        const padX = 4 * zs;
        const padY = 2 * zs;
        const metrics = ctx.measureText(label);
        ctx.fillStyle = EDGE_LABEL_BACKGROUND;
        ctx.fillRect(
          lx - metrics.width / 2 - padX,
          ly - 6 * zs - padY,
          metrics.width + padX * 2,
          12 * zs + padY * 2
        );
        ctx.fillStyle = EDGE_LABEL_COLOR;
        ctx.fillText(label, lx, ly);
      }
    }

    ctx.setLineDash([]);
  }, [
    geometries,
    viewport,
    width,
    height,
    selectedEdgeId,
    selectedEdgeIds,
    highlightedEdgeIds,
    getEdgeStyle,
    getEdgeLabel,
  ]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactive || !onEdgeHover) return;
      const hit = hitTest(e.clientX, e.clientY);
      const nextId = hit?.id ?? null;
      if (nextId === hoveredEdgeRef.current) return;
      hoveredEdgeRef.current = nextId;
      onEdgeHover(nextId, nextId ? e : null);
    },
    [hitTest, interactive, onEdgeHover]
  );

  const handlePointerLeave = useCallback(() => {
    if (!onEdgeHover || hoveredEdgeRef.current === null) return;
    hoveredEdgeRef.current = null;
    onEdgeHover(null, null);
  }, [onEdgeHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive || !onEdgeClick) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      e.stopPropagation();
      onEdgeClick(hit.id, e);
    },
    [hitTest, interactive, onEdgeClick]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive || !onEdgeContextMenu) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      onEdgeContextMenu(hit.id, e);
    },
    [hitTest, interactive, onEdgeContextMenu]
  );

  return (
    <canvas
      ref={canvasRef}
      data-gc-edge-canvas
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: interactive ? "auto" : "none",
        // This is the full-size background hit surface. Prevent the browser's
        // page-pan gesture from cancelling single-touch canvas interactions;
        // graph chrome and consumer controls are separate siblings above it.
        touchAction: interactive ? "none" : undefined,
      }}
      aria-hidden
    />
  );
}) as <T, E>(props: EdgeCanvasLayerProps<T, E>) => React.ReactElement | null;
