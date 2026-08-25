"use client";

import { useRef, useState, useMemo, useEffect, useCallback, useId, useImperativeHandle } from "react";
import { zoomTransform } from "d3-zoom";
import {
  GraphCanvasStoreContext,
  createGraphCanvasStore,
  useGraphCanvasStore,
  useRawGraphCanvasStore,
} from "./store.js";
import { createGraphLink } from "./link/GraphLink.js";
import { useGraphLink } from "./link/context.js";
import { useGraphLinkBridge } from "./hooks/useGraphLinkBridge.js";
import { useCanvasZoom } from "./hooks/useCanvasZoom.js";
import { useForceLayout } from "./hooks/useForceLayout.js";
import { useSelectionSync } from "./hooks/useSelectionSync.js";
import { usePositionSync } from "./hooks/usePositionSync.js";
import { useSpaceBarPan } from "./hooks/useSpaceBarPan.js";
import { useViewportSize } from "./hooks/useViewportSize.js";
import { useContextMenu } from "./hooks/useContextMenu.js";
import { useDragToConnect } from "./hooks/useDragToConnect.js";
import { useMarqueeSelect } from "./hooks/useMarqueeSelect.js";
import { useCanvasNodeDrag } from "./hooks/useCanvasNodeDrag.js";
import { SpatialIndex } from "./spatialIndex.js";
import {
  DEFAULT_NODE_RADIUS,
  getEdgeAnchors,
  getEdgeRouteGeometry,
  getNodeRadius,
  getVisibleGraphRect,
  resolveEdgeControlPoints,
  resolveEdgeCurveStrength,
  resolveEdgeRouteType,
  resolvePortNormal,
} from "./geometry.js";
import { NodeLayer } from "./renderers/NodeLayer.js";
import { NodeCanvasLayer } from "./renderers/NodeCanvasLayer.js";
import { EdgeCanvasLayer } from "./renderers/EdgeCanvasLayer.js";
import { MiniMap } from "./renderers/MiniMap.js";
import { AccessibilityLayer } from "./renderers/AccessibilityLayer.js";
import { useKeyboardNav } from "./hooks/useKeyboardNav.js";
import { createConnectionValidator } from "./validation.js";
import { isChromeEvent, isInteractiveTarget, resolvePrimaryGestureOwner } from "./interaction.js";
import { resolveNodePorts } from "./ports.js";
import type { CSSProperties } from "react";
import type { GraphCanvasProps, GraphCanvasRef, GraphEdge, GraphNode, NodePosition } from "./types.js";

const DEFAULT_LINK_DISTANCE = 140;
const DEFAULT_CHARGE_STRENGTH = -400;
const CONTEXT_MENU_HORIZONTAL_GUTTER = 220;
const CONTEXT_MENU_VERTICAL_GUTTER = 180;

// Screen-space hit-test tolerances (divided by zoom at use site). Hover is
// tighter than click so the highlight tracks the node you're actually over.
const CLICK_TOLERANCE_PX = 30;
const HOVER_TOLERANCE_PX = 10;

/** Multiplier applied by one press of the zoom-in / zoom-out chrome buttons. */
const ZOOM_STEP = 1.3;

/** Screen-space breathing room required around a node before keyboard focus
 *  counts it as already revealed. Without a margin a node flush against the
 *  viewport edge reads as visible while being half-clipped. */
const REVEAL_MARGIN_PX = 24;

/** Grace period before the edge toolbar closes once the pointer leaves the
 *  edge, so it can be moved onto the toolbar itself. */
const TOOLBAR_CLOSE_GRACE_MS = 220;
/** Hover dwell before an edge toolbar appears. */
const DEFAULT_EDGE_TOOLBAR_DELAY_MS = 600;

/** Background pattern spacing when snapToGrid isn't set. */
const BACKGROUND_GRID_SIZE = 16;
const BACKGROUND_PATTERN_COLOR = "rgba(148, 163, 184, 0.18)";

export { GC_CHROME_SELECTOR } from "./interaction.js";

/** Visually hidden but still exposed to assistive tech and focusable. */
const SR_ONLY_STYLE: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

// Stable default so effects depending on `initialPositions` don't re-run
// every render when the prop is omitted.
const EMPTY_POSITIONS: Record<string, NodePosition> = {};

// Inert fallback so the link bridge can subscribe unconditionally even when a
// graph isn't participating in any GraphLink.
const EMPTY_LINK = createGraphLink();
const identityKey = (id: string) => id;

function filterKnownPositions<T>(
  positions: Record<string, NodePosition>,
  nodeById: Map<string, GraphNode<T>>
): Record<string, NodePosition> {
  const next = Object.create(null) as Record<string, NodePosition>;
  for (const [id, position] of Object.entries(positions)) {
    if (nodeById.has(id)) next[id] = position;
  }
  return next;
}

// ─── Inner component (has access to the store via context) ────────────────────

function GraphCanvasInner<T, E>({
  nodes,
  edges,
  getNodeRadius: getNodeRadiusProp,
  getNodeShape,
  getNodeAnchor,
  renderNode,
  renderCanvasNode,
  renderPort,
  renderCanvasPort,
  renderContextMenu,
  getNodeSize,
  getNodePorts,
  isValidConnection,
  getEdgeStyle,
  getEdgeRoute,
  getEdgeCurveStrength,
  getEdgeControlPoints,
  layoutEnabled = true,
  layoutLinkDistance = DEFAULT_LINK_DISTANCE,
  layoutChargeStrength = DEFAULT_CHARGE_STRENGTH,
  onNodeMove,
  onConnect,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onCanvasDoubleClick,
  onPositionsChange,
  initialPositions = EMPTY_POSITIONS,
  selectedNodeIds: controlledSelection,
  onSelectionChange,
  linkId,
  link: linkProp,
  toLinkKey,
  highlightedNodeIds: highlightedNodeIdsProp,
  onNodeHover,
  crossGraphDrag = false,
  onExternalDrop,
  marqueeSelect = false,
  panOnDrag = false,
  showBackground = false,
  snapToGrid,
  showZoomControls = false,
  selectedEdgeIds,
  onEdgeActivate,
  highlightedEdgeIds: highlightedEdgeIdsProp,
  getEdgeLabel,
  onEdgeHover,
  renderEdgeToolbar,
  edgeToolbarDelay = DEFAULT_EDGE_TOOLBAR_DELAY_MS,
  className,
  style,
  graphRef,
  children,
  showFitView = true,
  showMinimap = false,
  keyboardNav = true,
  getNodeLabel,
  renderAllNodes = false,
}: GraphCanvasProps<T, E>) {
  // ── Store selectors
  const positions = useGraphCanvasStore((s) => s.positions);
  const viewport = useGraphCanvasStore((s) => s.viewport);
  const transientDepth = useGraphCanvasStore((s) => s.transientDepth);

  // ── Raw store ref (for imperative callbacks)
  const store = useRawGraphCanvasStore();

  const validNodeIds = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes]
  );
  const filteredControlledSelection = useMemo(
    () => controlledSelection?.filter((id) => validNodeIds.has(id)),
    [controlledSelection, validNodeIds]
  );

  // ── Selection sync (controlled ↔ store)
  const { effectiveSelection } = useSelectionSync({
    controlledSelection: filteredControlledSelection,
    onSelectionChange,
  });

  // ── Position change notifications + seeding new nodes
  usePositionSync({ nodes, initialPositions, onPositionsChange });

  // ── Memoised helpers
  const resolvedGetNodeRadius = useCallback(
    (node: GraphNode<T>) => getNodeRadius(node, getNodeRadiusProp),
    [getNodeRadiusProp]
  );

  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );
  const edgeById = useMemo(
    () => new Map(edges.map((edge) => [edge.id, edge] as const)),
    [edges]
  );
  const edgeIds = useMemo(() => edges.map((e) => e.id), [edges]);

  // ── Spatial index (per-instance, lives in a ref)
  const spatialIndex = useRef(new SpatialIndex<T>());
  const indexedNodesRef = useRef<GraphNode<T>[] | null>(null);
  const indexedRadiusFnRef = useRef<typeof getNodeRadiusProp | null>(null);
  const indexedPositionsRef = useRef<Record<string, NodePosition> | null>(null);
  const indexedPortsFnRef = useRef<typeof getNodePorts | null>(null);
  const indexedSizeFnRef = useRef<typeof getNodeSize | null>(null);
  const indexedShapeFnRef = useRef<typeof getNodeShape | null>(null);

  // Shared port lookup, handed to geometry so edge anchors resolve to exact
  // port positions, and to the drag hook so previews land on the same points.
  const portResolver = useMemo(
    () => (getNodePorts ? { getNodePorts, getNodeSize } : undefined),
    [getNodePorts, getNodeSize]
  );

  // One validator for the whole graph, shared by every path that can create an
  // edge (pointer drag, keyboard connect). Building it here rather than inside
  // each hook is what stops the two from drifting apart.
  const validateConnection = useMemo(
    () => createConnectionValidator({ nodeById, getNodePorts, edges, isValidConnection }),
    [nodeById, getNodePorts, edges, isValidConnection]
  );


  // A single effect handles both full rebuilds (when the node list or radius
  // function identity changes) and incremental position updates. Keeping
  // everything in one effect avoids a fragile ordering dependency between
  // rebuild and patch.
  useEffect(() => {
    // Port config must be current before any rebuild/update writes to the
    // port tree, and a change of port function invalidates every port bound.
    spatialIndex.current.configurePorts(getNodePorts, getNodeSize);
    // Shape feeds node bounds the same way — see buildBounds.
    spatialIndex.current.configureShape(getNodeShape);

    const needsFullRebuild =
      indexedNodesRef.current !== nodes ||
      indexedRadiusFnRef.current !== getNodeRadiusProp ||
      indexedPortsFnRef.current !== getNodePorts ||
      // Port boxes are derived from the node's size, and `configurePorts`
      // only stores the reference — it recomputes nothing. Without this the
      // effect re-runs, takes the incremental branch and bails on the
      // positions check, leaving every port hitbox at its old geometry while
      // the drawn ports and edge anchors move.
      indexedSizeFnRef.current !== getNodeSize ||
      // Node bounds are derived from the shape as well as the radius.
      indexedShapeFnRef.current !== getNodeShape;

    if (needsFullRebuild) {
      spatialIndex.current.rebuild(nodes, positions, getNodeRadiusProp);
    } else {
      const prev = indexedPositionsRef.current;
      if (prev === positions) return;

      if (prev) {
        const removedIds: string[] = [];
        for (const id of Object.keys(prev)) {
          if (!positions[id] || !nodeById.has(id)) removedIds.push(id);
        }
        if (removedIds.length > 0) spatialIndex.current.remove(removedIds);
      }

      for (const node of nodes) {
        const next = positions[node.id];
        if (!next) continue;
        const previous = prev?.[node.id];
        if (
          !previous ||
          previous.x !== next.x ||
          previous.y !== next.y
        ) {
          spatialIndex.current.update(node, next, getNodeRadiusProp);
        }
      }
    }

    indexedNodesRef.current = nodes;
    indexedRadiusFnRef.current = getNodeRadiusProp;
    indexedPositionsRef.current = positions;
    indexedPortsFnRef.current = getNodePorts;
    indexedSizeFnRef.current = getNodeSize;
    indexedShapeFnRef.current = getNodeShape;
  }, [nodes, nodeById, positions, getNodeRadiusProp, getNodePorts, getNodeSize, getNodeShape]);

  // ── Space-bar pan
  // The container ref is owned here so both hooks can share it: the zoom hook
  // attaches d3 to it, and the space-pan hook scopes its window listeners to
  // it rather than hijacking Space for the whole page.
  const containerRef = useRef<HTMLDivElement>(null);
  // D3 is attached before the pointer-owning hooks below are created. Its
  // pinch callback reads through this ref so it can still cancel their latest
  // in-flight gesture synchronously from touchstart.
  const cancelSinglePointerGesturesRef = useRef<() => void>(() => {});
  const cancelActiveHtmlNodeDragRef = useRef<((pointerId?: number) => void) | null>(null);

  // Lets the zoom filter ask whether a press landed on a node. Canvas nodes
  // have no DOM, so a selector-only test would call them blank canvas and hand
  // the same drag to a different owner once selection promoted them.
  const isPointOnNode = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      if (!el || !rect) return false;
      // D3 updates `__zoom` synchronously while the React store is RAF-batched.
      // Gesture arbitration must use the live transform or a press immediately
      // after wheel/pan can hit-test against the previous viewport.
      const stored = store.getState().viewport;
      const live = "__zoom" in el ? zoomTransform(el) : null;
      const x = live?.x ?? stored.x;
      const y = live?.y ?? stored.y;
      const zoom = live?.k ?? stored.zoom;
      const gx = (clientX - rect.left - x) / zoom;
      const gy = (clientY - rect.top - y) / zoom;
      return spatialIndex.current.pickAt(gx, gy, 0) !== null;
    },
    [store]
  );

  const { spacePressedRef, isSpacePressed } = useSpaceBarPan(containerRef);

  // ── Zoom / pan (D3)
  const { layoutReady, fitToView, panTo, zoomBy, userInteractedRef } = useCanvasZoom({
    containerRef,
    spacePressedRef,
    panOnDrag,
    marqueeSelect,
    isPointOnNode,
    onPinchStart: () => cancelSinglePointerGesturesRef.current(),
  });

  // Keep the latest node map + radius fn in refs so the imperative handle
  // below doesn't re-create on every position/nodes tick.
  const nodeByIdRef = useRef(nodeById);
  nodeByIdRef.current = nodeById;
  const resolvedGetNodeRadiusRef = useRef(resolvedGetNodeRadius);
  resolvedGetNodeRadiusRef.current = resolvedGetNodeRadius;

  const imperativeHandle = useMemo<GraphCanvasRef>(
    () => ({
      fitToView: () => {
        fitToView(filterKnownPositions(store.getState().positions, nodeByIdRef.current), (id) => {
          const node = nodeByIdRef.current.get(id);
          return node ? resolvedGetNodeRadiusRef.current(node) : 40;
        });
      },
      panTo,
      panToNode: (id: string, targetZoom: number = 2) => {
        const pos = store.getState().positions[id];
        if (pos) panTo(pos.x, pos.y, targetZoom);
      },
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      getZoom: () => store.getState().viewport.zoom,
    }),
    [fitToView, panTo, store, zoomBy]
  );
  useImperativeHandle(graphRef, () => imperativeHandle, [imperativeHandle]);

  // Keep the handle in a ref so the link registry always resolves the latest.
  const handleRef = useRef<GraphCanvasRef | null>(imperativeHandle);
  handleRef.current = imperativeHandle;

  // ── Keyboard / screen-reader operation (the canvas layers are aria-hidden)
  const a11yDescriptionId = useId();
  // Stable identity: `focusNode` depends on this, and AccessibilityLayer is
  // memoised on `onFocusNode` — an inline arrow here re-renders every node
  // button on every render of the graph.
  const panToNode = useCallback(
    (id: string) => {
      const state = store.getState();
      const pos = state.positions[id];
      if (!pos) return;

      // Reveal, not recentre. Arrow-keying between two nodes that are both
      // already on screen must not yank the viewport on every step — the
      // graph would slide under the user for no reason. Reads through refs so
      // this callback keeps the stable identity AccessibilityLayer memoises on.
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const view = getVisibleGraphRect(state.viewport, rect.width, rect.height);
        const node = nodeByIdRef.current.get(id);
        const margin =
          (node ? resolvedGetNodeRadiusRef.current(node) : DEFAULT_NODE_RADIUS) +
          REVEAL_MARGIN_PX / Math.max(state.viewport.zoom, 0.01);
        if (
          pos.x - margin >= view.minX &&
          pos.x + margin <= view.maxX &&
          pos.y - margin >= view.minY &&
          pos.y + margin <= view.maxY
        ) return;
      }

      panTo(pos.x, pos.y, state.viewport.zoom, false);
    },
    [store, panTo, containerRef]
  );

  // Every semantic activation — keyboard Enter/Space as well as an
  // AT-dispatched click — lands here, so a consumer's onNodeClick fires for
  // keyboard users too, not only for pointer paths. The keyboard path forwards
  // its KeyboardEvent, which carries the same modifier/target shape a
  // browser-synthesised click would; it is cast once at this single boundary.
  const handleNodeActivated = useCallback(
    (id: string, event: React.SyntheticEvent) => {
      onNodeClick?.(id, event as React.MouseEvent);
    },
    [onNodeClick]
  );

  const {
    focusedId: keyboardFocusId,
    connectFromId,
    focusNode,
    activateNode,
    onKeyDown: onKeyboardNavKeyDown,
    focusedEdgeId,
    focusEdge,
    connectCandidate,
    connectCandidateIndex,
    connectCandidateCount,
  } = useKeyboardNav({
    nodes,
    positions,
    store,
    panToNode,
    onNodeMove,
    onConnect,
    onNodeActivate: handleNodeActivated,
    enabled: keyboardNav,
    snapToGrid,
    getNodePorts,
    validateConnection,
    edgeIds,
    onEdgeActivate,
  });

  // Roving focus follows the DOM focus of the a11y buttons; revealing here
  // would fight the browser's own scroll-into-view.
  const handleFocusNode = useCallback(
    (id: string) => focusNode(id, { reveal: false }),
    [focusNode]
  );

  const handleA11yNodeActivate = useCallback(
    (id: string, event: React.MouseEvent) => {
      // A semantic button click can be emitted directly by assistive tech,
      // without the keydown path below. Keep it out of canvas hit-testing and
      // give it the same selection semantics as pointer/keyboard activation.
      // onNodeClick fires via the hook's onNodeActivate, and only when the
      // activation selected the node rather than completing a pending connect.
      event.stopPropagation();
      focusNode(id, { reveal: false });
      activateNode(id, event.shiftKey, event);
    },
    [activateNode, focusNode]
  );

  // Announce which port pairing Enter would commit, and that more exist —
  // otherwise cycling with [ / ] is invisible to a screen-reader user.
  const connectHint = useMemo(() => {
    if (!connectCandidate) return undefined;
    const targetNode = nodeById.get(connectCandidate.target);
    const targetName = targetNode ? (getNodeLabel?.(targetNode) ?? connectCandidate.target) : connectCandidate.target;
    const portName = (id: string | undefined, nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (!node || !id) return null;
      const port = resolveNodePorts(node, getNodePorts).find((p) => p.id === id);
      return port ? (port.label ?? port.id) : null;
    };
    const from = portName(connectCandidate.sourcePort, connectCandidate.source);
    const to = portName(connectCandidate.targetPort, connectCandidate.target);
    const via = [from && `from ${from}`, to && `to ${to}`].filter(Boolean).join(" ");
    const choice = connectCandidateCount > 1
      ? `, option ${connectCandidateIndex + 1} of ${connectCandidateCount}, use bracket keys to change`
      : "";
    return `connecting to ${targetName}${via ? ` ${via}` : ""}${choice}`;
  }, [connectCandidate, connectCandidateCount, connectCandidateIndex, nodeById, getNodeLabel, getNodePorts]);

  // ── Cross-graph link (isolated stores, shared signals)
  const ctxLink = useGraphLink();
  const resolvedLink = linkProp ?? ctxLink ?? EMPTY_LINK;
  const linkActive = !!(linkId && (linkProp ?? ctxLink));
  const toKey = toLinkKey ?? identityKey;

  // Hovered node id (drives cross-graph hover highlight + onNodeHover).
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  // ── Edge selection / highlight (sets, so the layer can test membership)
  const selectedEdgeSet = useMemo(
    () => (selectedEdgeIds ? new Set(selectedEdgeIds) : undefined),
    [selectedEdgeIds]
  );
  const highlightedEdgeSet = useMemo(
    () => (highlightedEdgeIdsProp ? new Set(highlightedEdgeIdsProp) : undefined),
    [highlightedEdgeIdsProp]
  );

  // The keyboard-focused edge is drawn with the highlight treatment, so a
  // keyboard user can see which edge they are on. Without this the edge
  // listbox moves an invisible cursor over aria-hidden raster.
  const focusedEdgeHighlightSet = useMemo(() => {
    if (!focusedEdgeId) return highlightedEdgeSet;
    const next = new Set(highlightedEdgeSet ?? []);
    next.add(focusedEdgeId);
    return next;
  }, [highlightedEdgeSet, focusedEdgeId]);

  // Resolve the same routed midpoint used to paint an edge. Keyboard-opened
  // menus and keyboard-revealed toolbars cannot use pointer coordinates, so
  // both anchor to this visual geometry instead.
  const resolveEdgeVisual = useCallback(
    (edge: GraphEdge<E>) => {
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) return null;

      const anchors = getEdgeAnchors(
        sourceNode,
        targetNode,
        positions,
        resolvedGetNodeRadius,
        getNodeAnchor,
        edge.sourcePort,
        edge.targetPort,
        portResolver
      );
      if (!anchors) return null;

      const route = resolveEdgeRouteType(
        edge,
        sourceNode,
        targetNode,
        anchors.source,
        anchors.target,
        "edge",
        getEdgeRoute
      );
      const strength = resolveEdgeCurveStrength(
        edge,
        sourceNode,
        targetNode,
        anchors.source,
        anchors.target,
        "edge",
        getEdgeCurveStrength
      );
      const controlPoints = resolveEdgeControlPoints(
        edge,
        sourceNode,
        targetNode,
        anchors.source,
        anchors.target,
        "edge",
        route,
        strength,
        getEdgeControlPoints,
        // The same normals EdgeCanvasLayer paints with. Without them an
        // s-curved port-to-port edge resolves its handles from the dominant
        // axis instead of the port faces, so this midpoint lands tens of
        // graph units off the curve the user is actually looking at.
        anchors.sourceNormal,
        anchors.targetNormal
      );
      const geometry = getEdgeRouteGeometry(
        anchors.source,
        anchors.target,
        route,
        strength,
        controlPoints
      );
      return { sourceNode, targetNode, position: geometry.labelPosition };
    },
    [
      nodeById,
      positions,
      resolvedGetNodeRadius,
      getNodeAnchor,
      portResolver,
      getEdgeRoute,
      getEdgeCurveStrength,
      getEdgeControlPoints,
    ]
  );


  // ── Edge hover, with a dwell delay before the toolbar appears so it doesn't
  // flash while the pointer merely crosses an edge on its way somewhere else.
  const [toolbarEdgeId, setToolbarEdgeId] = useState<string | null>(null);
  const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarEdgeIdRef = useRef<string | null>(toolbarEdgeId);
  toolbarEdgeIdRef.current = toolbarEdgeId;

  const isCurrentEdgeToolbarFocus = useCallback(
    (target: EventTarget | null, edgeId: string | null = toolbarEdgeIdRef.current) => {
      const container = containerRef.current;
      if (!container || !(target instanceof Element) || !container.contains(target)) return false;

      const toolbar = target.closest("[data-gc-edge-toolbar]");
      if (toolbar && container.contains(toolbar)) {
        return edgeId === null || toolbar.getAttribute("data-gc-edge-toolbar") === edgeId;
      }

      // A toolbar opened by keyboard belongs to its semantic edge option too.
      // Keeping it mounted while that option retains focus lets Tab reach the
      // toolbar even if an unrelated pointer happens to leave the edge.
      const edgeOption = target.closest("[data-gc-a11y-edge]");
      return !!(
        edgeOption &&
        container.contains(edgeOption) &&
        (edgeId === null || edgeOption.getAttribute("data-gc-a11y-edge") === edgeId)
      );
    },
    [containerRef]
  );

  const currentEdgeToolbarHasFocus = useCallback(
    () => isCurrentEdgeToolbarFocus(document.activeElement),
    [isCurrentEdgeToolbarFocus]
  );

  const handleEdgeHover = useCallback(
    (id: string | null, event: React.PointerEvent | null) => {
      onEdgeHover?.(id, event);
      if (!renderEdgeToolbar) return;
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
      if (id === null) {
        // Closing synchronously made the toolbar unreachable: it is a sibling
        // overlay, so moving the pointer off the edge and onto it fires
        // pointerleave on the edge canvas *before* pointerenter on the
        // toolbar. Give the pointer a moment to arrive; the toolbar's own
        // pointerenter cancels this timer.
        toolbarTimerRef.current = setTimeout(() => {
          if (!currentEdgeToolbarHasFocus()) setToolbarEdgeId(null);
        }, TOOLBAR_CLOSE_GRACE_MS);
        return;
      }
      toolbarTimerRef.current = setTimeout(() => {
        // Pointer hover must not retarget a toolbar while one of its controls
        // (or the owning semantic edge) has keyboard focus. Replacing it here
        // would either drop focus or make the focused action operate on a
        // different edge from the one the user reached with the keyboard.
        if (!currentEdgeToolbarHasFocus()) setToolbarEdgeId(id);
      }, edgeToolbarDelay);
    },
    [onEdgeHover, renderEdgeToolbar, edgeToolbarDelay, currentEdgeToolbarHasFocus]
  );

  const handleFocusEdge = useCallback(
    (id: string) => {
      focusEdge(id);
      if (!renderEdgeToolbar) return;
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
      setToolbarEdgeId(id);
    },
    [focusEdge, renderEdgeToolbar]
  );

  const handleA11yEdgeActivate = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation();
      focusEdge(id);
      onEdgeActivate?.(id);
    },
    [focusEdge, onEdgeActivate]
  );

  const handleBlurEdge = useCallback((id: string, event: React.FocusEvent) => {
    const next = event.relatedTarget;
    if (isCurrentEdgeToolbarFocus(next, id)) return;
    setToolbarEdgeId((current) => (current === id ? null : current));
  }, [isCurrentEdgeToolbarFocus]);

  useEffect(() => () => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
  }, []);

  // The registration is created once, so the drop handler is exposed as a
  // getter reading a live ref — that way both its identity AND its presence
  // (a graph may start or stop accepting drops) stay current without churning
  // the registry on every render.
  const onExternalDropRef = useRef(onExternalDrop);
  onExternalDropRef.current = onExternalDrop;

  const linkHighlight = useGraphLinkBridge({
    link: resolvedLink,
    active: linkActive,
    graphId: linkId,
    toKey,
    nodes,
    selection: effectiveSelection,
    hoveredNodeId,
    getHandle: () => handleRef.current,
    getContainer: () => containerRef.current,
    getViewport: () => store.getState().viewport,
    getOnExternalDrop: () => onExternalDropRef.current,
  });

  const highlightedNodeIds = useMemo(() => {
    const extra = highlightedNodeIdsProp;
    if (!extra || extra.length === 0) return linkHighlight;
    if (linkHighlight.length === 0) return extra;
    return [...new Set([...linkHighlight, ...extra])];
  }, [linkHighlight, highlightedNodeIdsProp]);

  // ── Force layout (D3)
  useForceLayout({
    nodes,
    edges,
    enabled: layoutEnabled,
    linkDistance: layoutLinkDistance,
    chargeStrength: layoutChargeStrength,
    getNodeRadius: resolvedGetNodeRadius,
  });

  // ── Viewport size (for Canvas renderer, and as the auto-fit re-run trigger)
  const viewportSize = useViewportSize(containerRef);

  // ── Auto fit-to-view once the first layout run completes. Waiting for
  // transientDepth === 0 means we fit the settled layout, not the first
  // mid-simulation position flush.
  const hasFitted = useRef(false);
  const hasHadContent = useRef(false);
  useEffect(() => {
    if (hasFitted.current) return;

    // Nothing to frame yet (nodes still loading). Return WITHOUT latching, so a
    // graph whose data arrives later still gets its initial fit.
    const knownPositions = filterKnownPositions(positions, nodeById);
    if (Object.keys(knownPositions).length === 0) return;

    // Panning an empty canvas isn't the user taking charge of a layout — only
    // interactions from the first frame that had content count as that.
    if (!hasHadContent.current) {
      hasHadContent.current = true;
      userInteractedRef.current = false;
    }

    if (!layoutReady || transientDepth > 0) return;

    // A hidden container (collapsed panel, background tab) measures 0×0;
    // fitting against it clamps the scale to MIN_ZOOM and the latch below
    // would keep that garbage fit forever. Return WITHOUT latching —
    // `viewportSize` is in the deps, so the ResizeObserver re-runs this effect
    // once the container gains real size.
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    // The user may have panned/zoomed while the simulation was still settling —
    // don't yank the viewport out from under them once it finishes.
    if (userInteractedRef.current) {
      hasFitted.current = true;
      return;
    }

    hasFitted.current = true;
    fitToView(knownPositions, (id) => {
      const node = nodeById.get(id);
      return node ? resolvedGetNodeRadius(node) : 40;
    });
  }, [layoutReady, positions, transientDepth, fitToView, nodeById, resolvedGetNodeRadius, userInteractedRef, viewportSize]);

  // ── Transform string (for HTML node layer)
  const transformStyle = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

  // ── SVG transform (for preview line only)
  const svgTransform = `translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`;

  // ── Context menu
  const {
    contextMenuRef,
    contextMenu,
    closeContextMenu,
    handleCanvasContextMenu,
    handleNodeContextMenu,
    handlePortContextMenu,
    handleEdgeContextMenu,
    openNodeContextMenuAt,
    openEdgeContextMenuAt,
  } = useContextMenu({
    containerRef,
    viewport,
    renderContextMenu,
    nodeById,
    edgeById,
    nodePositions: positions,
    getNodePorts,
    getNodeSize,
  });

  const handleA11yNodeContextMenu = useCallback(
    (id: string, event: React.MouseEvent) => {
      // Always consume the semantic event. If layout has not produced the
      // anchor yet, allowing it to bubble would open the canvas menu at the
      // keyboard event's synthetic (0, 0) coordinates instead.
      event.preventDefault();
      event.stopPropagation();
      const position = positions[id];
      if (!position) return;
      openNodeContextMenuAt(id, position);
    },
    [openNodeContextMenuAt, positions]
  );

  const handleA11yEdgeContextMenu = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const edge = edgeById.get(id);
      if (!edge) return;
      const visual = resolveEdgeVisual(edge);
      if (!visual) return;
      openEdgeContextMenuAt(id, visual.position);
    },
    [edgeById, openEdgeContextMenuAt, resolveEdgeVisual]
  );

  // ── Drag-to-connect
  const {
    dragLine,
    onConnectStart,
    onContainerPointerMove,
    onContainerPointerUp,
    onContainerPointerCancel,
    cancelDrag: cancelConnectDrag,
    justConnectedRef,
  } =
    useDragToConnect({
      containerRef,
      viewport,
      positions,
      nodeById,
      spatialIndex,
      resolvedGetNodeRadius,
      getNodeAnchor,
      onConnect,
      portResolver,
      validateConnection,
      onDragStart: closeContextMenu,
      link: linkActive ? resolvedLink : null,
      graphId: linkId,
      crossGraphDrag,
      toKey,
    });

  // ── Marquee (rubber-band) selection
  const {
    marqueeRect,
    justMarqueedRef,
    onPointerDown: onMarqueeDown,
    onPointerMove: onMarqueeMove,
    onPointerUp: onMarqueeUp,
    onPointerCancel: onMarqueeCancel,
  } = useMarqueeSelect({
    containerRef,
    viewport,
    nodes,
    spatialIndex,
    spacePressedRef,
    store,
    enabled: marqueeSelect,
  });

  // ── Dragging nodes that are still painted on the canvas.
  // Selection promotes a node into NodeLayer, which handles its own drags; an
  // unselected node is inert paint, so the press has to be caught here.
  const {
    onPointerDown: onCanvasNodeDown,
    onPointerMove: onCanvasNodeMove,
    onPointerUp: onCanvasNodeUp,
    onPointerCancel: onCanvasNodeCancel,
    justDraggedRef,
  } = useCanvasNodeDrag({
    containerRef,
    store,
    spatialIndex,
    viewport,
    spacePressedRef,
    // In panOnDrag mode a left-drag is explicitly "pan the view", so canvas
    // nodes stay put and d3 keeps the gesture.
    enabled: !panOnDrag,
    snapToGrid,
    onNodeMove,
  });

  /** Cancel every single-contact owner before a pinch takes over. Each hook's
   * cancel path restores transient node movement and suppresses callbacks. */
  const cancelSinglePointerGestures = useCallback(() => {
    cancelConnectDrag();
    onCanvasNodeCancel();
    onMarqueeCancel();
    cancelActiveHtmlNodeDragRef.current?.();
  }, [cancelConnectDrag, onCanvasNodeCancel, onMarqueeCancel]);
  cancelSinglePointerGesturesRef.current = cancelSinglePointerGestures;

  // Hover hit-test (only when something consumes hover: a link or onNodeHover).
  const hoverEnabled = !!(onNodeHover || linkActive);

  const setHovered = useCallback(
    (id: string | null, e: React.PointerEvent | null) => {
      if (hoveredIdRef.current === id) return;
      hoveredIdRef.current = id;
      setHoveredNodeId(id);
      onNodeHover?.(id, e);
    },
    [onNodeHover]
  );

  const handleHoverMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hoverEnabled) return;
      // Chrome overlays sit above the graph; a move over them must not
      // hit-test (and highlight) whatever node happens to be hidden beneath.
      if (isChromeEvent(e)) {
        setHovered(null, e);
        return;
      }
      // React portal events follow the component tree even when their DOM
      // target lives outside the graph. Controls rendered through renderNode
      // must not spatially hover whatever happens to sit at their coordinates.
      if (isInteractiveTarget(e.target)) {
        if (!(e.target as HTMLElement).closest?.("[data-gc-node]")) setHovered(null, e);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      setHovered(spatialIndex.current.pickAt(gx, gy, HOVER_TOLERANCE_PX / Math.max(viewport.zoom, 0.3)), e);
    },
    [hoverEnabled, containerRef, viewport, setHovered]
  );

  const handleContainerPointerLeave = useCallback(() => {
    setHovered(null, null);
  }, [setHovered]);

  // Drop a stale hover when the hovered node disappears from the graph (or
  // hover stops being consumed) — otherwise the id keeps being published to
  // linked peers and onNodeHover(null) is never delivered.
  useEffect(() => {
    if (hoveredIdRef.current === null) return;
    if (!hoverEnabled || !nodeById.has(hoveredIdRef.current)) setHovered(null, null);
  }, [hoverEnabled, nodeById, setHovered]);

  const handleContainerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onContainerPointerMove(e);
      onCanvasNodeMove(e);
      onMarqueeMove(e);
      handleHoverMove(e);
    },
    [onContainerPointerMove, onCanvasNodeMove, onMarqueeMove, handleHoverMove]
  );

  const handleContainerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onContainerPointerUp(e);
      onCanvasNodeUp(e);
      onMarqueeUp(e);
    },
    [onContainerPointerUp, onCanvasNodeUp, onMarqueeUp]
  );

  // A cancelled pointer (gesture takeover, palm rejection, window switch) must
  // tear down every in-flight interaction, not just the marquee.
  const handleContainerPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Native cancellation belongs only to the pointer that initiated a
    // connection. Pinch takeover uses the force-cancel path above instead.
    onContainerPointerCancel(e);
    onCanvasNodeCancel(e);
    onMarqueeCancel(e);
    cancelActiveHtmlNodeDragRef.current?.(e.pointerId);
    handleContainerPointerLeave();
  }, [onContainerPointerCancel, onCanvasNodeCancel, onMarqueeCancel, handleContainerPointerLeave]);

  // React and d3 consult the same ownership function. This matters for painted
  // nodes: their event target is the edge canvas, so DOM selectors alone call
  // the point blank and start a marquee underneath d3's pan.
  const handleContainerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // The second touch converts the interaction to a pinch. A child HTML node
      // sees this event first, but declines non-primary touch below; cancel the
      // first touch's owner before d3 receives the following touchstart.
      if (e.pointerType === "touch" && !e.isPrimary) {
        cancelSinglePointerGestures();
        return;
      }
      if (e.button !== 0) return;

      const owner = resolvePrimaryGestureOwner({
        target: e.target,
        pointOnNode: isPointOnNode(e.clientX, e.clientY),
        spacePressed: spacePressedRef.current,
        panOnDrag,
        marqueeSelect,
      });
      if (owner === "node") {
        onCanvasNodeDown(e);
      } else if (owner === "marquee") {
        onMarqueeDown(e);
      }
    },
    [
      cancelSinglePointerGestures,
      isPointOnNode,
      marqueeSelect,
      onCanvasNodeDown,
      onMarqueeDown,
      panOnDrag,
      spacePressedRef,
    ]
  );

  // ── Canvas double-click → create node
  const onContainerDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target)) return;
      // Ignore double clicks that land on active React nodes
      if ((e.target as HTMLElement).closest("[data-gc-node]")) return;
      // ...or on canvas chrome: double-clicking "Fit view" must not also run
      // the canvas double-click action (which typically creates a node).
      if (isChromeEvent(e)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (e.clientY - rect.top - viewport.y) / viewport.zoom;

      // Hit-test canvas nodes since they aren't DOM elements.
      const SNAP_RADIUS = CLICK_TOLERANCE_PX / Math.max(viewport.zoom, 0.3);
      const clickedId = spatialIndex.current.pickAt(gx, gy, SNAP_RADIUS);
      if (clickedId) {
        onNodeDoubleClick?.(clickedId, e);
        return;
      }

      onCanvasDoubleClick?.(gx, gy);
    },
    [containerRef, viewport, onNodeDoubleClick, onCanvasDoubleClick]
  );

  // ── Canvas single-click → hit-test canvas nodes
  const onContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // After a marquee drag the browser fires a click event — suppress it
      // so it doesn't immediately undo the marquee selection.
      if (justMarqueedRef.current) {
        justMarqueedRef.current = false;
        e.stopPropagation();
        return;
      }

      // Same for a captured connect drag: pointer capture retargets the click
      // to this container (with coordinates that may be over another graph
      // entirely), which would otherwise clear the selection on every drop.
      if (justConnectedRef.current) {
        justConnectedRef.current = false;
        e.stopPropagation();
        return;
      }

      // And for a canvas node drag: the drag already did the work, so the
      // click that follows it must not also re-select or clear.
      if (justDraggedRef.current) {
        justDraggedRef.current = false;
        e.stopPropagation();
        return;
      }

      // renderNode may portal a control outside the graph DOM. React still
      // bubbles its event through this component tree, so DOM containment
      // selectors alone cannot keep it out of canvas hit-testing.
      if (isInteractiveTarget(e.target)) return;

      // If they clicked an active HTML node or its UI, ignore.
      if ((e.target as HTMLElement).closest("[data-gc-node]")) return;

      // Chrome overlays (minimap, context menu, fit button) own their clicks.
      if (isChromeEvent(e)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (e.clientY - rect.top - viewport.y) / viewport.zoom;

      const SNAP_RADIUS = CLICK_TOLERANCE_PX / Math.max(viewport.zoom, 0.3);
      const clickedId = spatialIndex.current.pickAt(gx, gy, SNAP_RADIUS);

      if (clickedId) {
        e.stopPropagation();
        if (e.shiftKey) {
          store.getState().toggleSelection(clickedId);
        } else {
          store.getState().setSelection([clickedId]);
        }
        onNodeClick?.(clickedId, e);
      } else if (!e.shiftKey && !spacePressedRef.current) {
        // Clicked empty space. Clear selection.
        store.getState().clearSelection();
      }
    },
    [containerRef, viewport, store, spacePressedRef, onNodeClick, justMarqueedRef, justConnectedRef, justDraggedRef]
  );

  const onContainerContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!renderContextMenu) return;
      if (isInteractiveTarget(e.target)) return;
      if (isChromeEvent(e)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        handleCanvasContextMenu(e);
        return;
      }

      const gx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const SNAP_RADIUS = CLICK_TOLERANCE_PX / Math.max(viewport.zoom, 0.3);
      const clickedId = spatialIndex.current.pickAt(gx, gy, SNAP_RADIUS);

      if (clickedId) {
        e.preventDefault();
        e.stopPropagation();
        handleNodeContextMenu(clickedId, e);
        return;
      }

      handleCanvasContextMenu(e);
    },
    [
      containerRef,
      viewport,
      spatialIndex,
      handleNodeContextMenu,
      handleCanvasContextMenu,
      renderContextMenu,
    ]
  );

  // ── Context menu flip: open away from the viewport edge when near it.
  const menuFlipX = !!(
    contextMenu &&
    viewportSize &&
    contextMenu.containerPosition.x > viewportSize.width - CONTEXT_MENU_HORIZONTAL_GUTTER
  );
  const menuFlipY = !!(
    contextMenu &&
    viewportSize &&
    contextMenu.containerPosition.y > viewportSize.height - CONTEXT_MENU_VERTICAL_GUTTER
  );

  // ── Edge toolbar anchor: graph midpoint of the hovered edge, in screen px.
  const edgeToolbar = useMemo(() => {
    if (!toolbarEdgeId || !renderEdgeToolbar) return null;
    const edge = edgeById.get(toolbarEdgeId);
    if (!edge) return null;
    const visual = resolveEdgeVisual(edge);
    if (!visual) return null;

    return {
      screen: {
        x: visual.position.x * viewport.zoom + viewport.x,
        y: visual.position.y * viewport.zoom + viewport.y,
      },
      props: {
        edge,
        sourceNode: visual.sourceNode,
        targetNode: visual.targetNode,
        position: visual.position,
      },
    };
  }, [toolbarEdgeId, renderEdgeToolbar, edgeById, resolveEdgeVisual, viewport]);

  // ── Preview geometry for drag-to-connect line
  const previewGeometry = useMemo(() => {
    if (!dragLine) return null;
    const sourceNode = nodeById.get(dragLine.sourceId);
    if (!sourceNode) return null;
    const targetNode = dragLine.snapId ? nodeById.get(dragLine.snapId) : undefined;
    const route = resolveEdgeRouteType(
      undefined,
      sourceNode,
      targetNode,
      dragLine.source,
      dragLine.target,
      "preview",
      getEdgeRoute
    );
    const curveStrength = resolveEdgeCurveStrength(
      undefined,
      sourceNode,
      targetNode,
      dragLine.source,
      dragLine.target,
      "preview",
      getEdgeCurveStrength
    );
    const controlPoints = resolveEdgeControlPoints(
      undefined,
      sourceNode,
      targetNode,
      dragLine.source,
      dragLine.target,
      "preview",
      route,
      curveStrength,
      getEdgeControlPoints,
      // Match the committed edge so the line doesn't jump shape on release.
      resolvePortNormal(sourceNode, dragLine.sourcePort, portResolver),
      dragLine.snapId && targetNode
        ? resolvePortNormal(targetNode, dragLine.snapPort, portResolver)
        : undefined
    );
    return getEdgeRouteGeometry(
      dragLine.source,
      dragLine.target,
      route,
      curveStrength,
      controlPoints
    );
  }, [dragLine, nodeById, getEdgeRoute, getEdgeCurveStrength, getEdgeControlPoints, portResolver]);

  // ── Background pattern.
  // A CSS background rather than a canvas pass: it composites on the GPU and
  // costs nothing per frame, and tracking the viewport is just two offsets.
  const backgroundStyle = useMemo<CSSProperties>(() => {
    // Nothing at all when disabled — these keys must then never appear, so
    // React has no longhand property to remove on a later render.
    if (!showBackground) return {};

    const spacing = (snapToGrid ?? BACKGROUND_GRID_SIZE) * viewport.zoom;
    const kind = showBackground === true ? "dots" : showBackground;

    // Once enabled, always emit the same three keys. Below a few pixels the
    // pattern is just noise, so it becomes `none` rather than disappearing:
    // dropping the key mid-render is what triggers React's shorthand/longhand
    // conflict warning against the container's own background colour.
    return {
      backgroundImage:
        spacing < 4
          ? "none"
          : kind === "grid"
            ? `linear-gradient(to right, ${BACKGROUND_PATTERN_COLOR} 1px, transparent 1px),
               linear-gradient(to bottom, ${BACKGROUND_PATTERN_COLOR} 1px, transparent 1px)`
            : `radial-gradient(circle, ${BACKGROUND_PATTERN_COLOR} 1px, transparent 1px)`,
      backgroundSize: `${spacing}px ${spacing}px`,
      backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    };
  }, [showBackground, snapToGrid, viewport.zoom, viewport.x, viewport.y]);

  return (
    // A composite graph widget with its own key bindings. The nodes are exposed
    // semantically by the AccessibilityLayer inside it, which is what keyboard
    // and screen-reader users actually operate; the pointer handlers here drive
    // canvas rendering and so belong on this element, not an interactive child.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={containerRef}
      data-gc-graph-id={linkActive ? linkId : undefined}
      role="application"
      aria-label="Graph canvas"
      className={`gc-canvas${panOnDrag ? " gc-pan-on-drag" : ""}${className ? ` ${className}` : ""}`}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        // Longhand, not the `background` shorthand: the pattern below sets
        // background-image/size/position, and mixing the two forms on one
        // element is what React warns about.
        backgroundColor: "#0f172a",
        visibility: layoutReady ? "visible" : "hidden",
        cursor: isSpacePressed ? "grab" : panOnDrag ? "crosshair" : "default",
        ...style,
        // After `style` so a consumer's `background` shorthand can't silently
        // wipe out a pattern they asked for via showBackground.
        ...backgroundStyle,
      }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerLeave={handleContainerPointerLeave}
      onPointerCancel={handleContainerPointerCancel}
      onKeyDown={onKeyboardNavKeyDown}
      onClick={onContainerClick}
      onDoubleClick={onContainerDoubleClick}
      onContextMenu={onContainerContextMenu}
    >
      {/* ── Canvas edge renderer (always active) */}
      {viewportSize && (
        <EdgeCanvasLayer
          edges={edges}
          nodeById={nodeById}
          positions={positions}
          viewport={viewport}
          width={viewportSize.width}
          height={viewportSize.height}
          getNodeRadius={resolvedGetNodeRadius}
          getNodeAnchor={getNodeAnchor}
          getEdgeStyle={getEdgeStyle}
          getEdgeRoute={getEdgeRoute}
          getEdgeCurveStrength={getEdgeCurveStrength}
          getEdgeControlPoints={getEdgeControlPoints}
          getEdgeLabel={getEdgeLabel}
          portResolver={portResolver}
          selectedEdgeIds={selectedEdgeSet}
          highlightedEdgeIds={focusedEdgeHighlightSet}
          onEdgeClick={onEdgeClick}
          onEdgeContextMenu={renderContextMenu ? handleEdgeContextMenu : undefined}
          onEdgeHover={handleEdgeHover}
          interactive
        />
      )}

      {/* ── SVG overlay for drag-to-connect preview line only */}
      {dragLine && previewGeometry && (
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
          aria-hidden
        >
          <g transform={svgTransform}>
            <path
              d={previewGeometry.path}
              fill="none"
              // Green = will connect, red = snapped but rejected, blue = free.
              // Showing the rejection during the drag beats silently dropping
              // the connection on release.
              stroke={
                !dragLine.snapId ? "#3b82f6" : dragLine.isValid ? "#22c55e" : "#ef4444"
              }
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          </g>
        </svg>
      )}

      {/* ── HTML node layer (selected / interactive nodes only) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: transformStyle,
          transformOrigin: "0 0",
          zIndex: 2, // must sit above the NodeCanvasLayer (zIndex:1) so connector handles and renderNode UI are not occluded
        }}
      >
        <NodeLayer
          nodes={nodes}
          nodeById={nodeById}
          positions={positions}
          selectedNodeIds={effectiveSelection}
          highlightedNodeIds={highlightedNodeIds}
          zoom={viewport.zoom}
          renderNode={renderNode}
          renderPort={renderPort}
          getNodePorts={getNodePorts}
          getNodeSize={getNodeSize}
          edges={edges}
          dragLine={dragLine}
          focusedNodeId={keyboardNav ? keyboardFocusId : null}
          connectFromId={connectFromId}
          // Same gate the canvas-node drag uses, so promoted and unpromoted
          // nodes respond to a left-drag identically.
          nodeDragEnabled={!panOnDrag && !isSpacePressed}
          connectEnabled={!isSpacePressed}
          activeDragCancelRef={cancelActiveHtmlNodeDragRef}
          onNodeMove={onNodeMove}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          // Passed only when there is a menu to open. These handlers call
          // preventDefault on presence alone, so wiring them unconditionally
          // suppressed the browser's own context menu and showed nothing in
          // its place.
          onNodeContextMenu={renderContextMenu ? handleNodeContextMenu : undefined}
          onPortContextMenu={renderContextMenu ? handlePortContextMenu : undefined}
          onConnectStart={onConnect || crossGraphDrag ? onConnectStart : undefined}
          activeOnly={!renderAllNodes}
          snapToGrid={snapToGrid}
        />
      </div>

      {/* ── Canvas node layer (all unselected nodes; skipped when renderAllNodes is true) */}
      {viewportSize && !renderAllNodes && (
        <NodeCanvasLayer
          nodes={nodes}
          positions={positions}
          viewport={viewport}
          width={viewportSize.width}
          height={viewportSize.height}
          getNodeRadius={resolvedGetNodeRadius}
          getNodeShape={getNodeShape}
          renderCanvasNode={renderCanvasNode}
          getNodePorts={getNodePorts}
          getNodeSize={getNodeSize}
          renderCanvasPort={renderCanvasPort}
          selectedNodeIds={effectiveSelection}
          highlightedNodeIds={highlightedNodeIds}
          focusedNodeId={keyboardNav ? keyboardFocusId : null}
          connectFromId={connectFromId}
        />
      )}

      {/* ── Context menu portal */}
      {renderContextMenu && contextMenu && (
        <div
          ref={contextMenuRef}
          data-gc-context-menu
          style={{
            position: "absolute",
            left: contextMenu.containerPosition.x,
            top: contextMenu.containerPosition.y,
            zIndex: 30,
            pointerEvents: "auto",
            transform: `translate(${menuFlipX ? "-100%" : "0"}, ${menuFlipY ? "-100%" : "0"}) translate(${menuFlipX ? "-8px" : "8px"}, ${menuFlipY ? "-8px" : "8px"})`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {renderContextMenu({
            ...contextMenu,
            closeMenu: closeContextMenu,
          })}
        </div>
      )}

      {/* ── Custom Consumer Overlay (Axes, HUDs, etc)
          Marked as chrome so an overlay that captures pointer events doesn't
          *also* select, move or double-click the node underneath it. An
          overlay meant to be clicked through should set `pointerEvents: none`
          on itself, in which case it is never the event target and this
          wrapper changes nothing. */}
      {children !== undefined && children !== null && (
        <div data-gc-chrome style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", display: "contents" }}>{children}</div>
        </div>
      )}

      {/* ── Marquee selection rectangle */}
      {marqueeRect && (
        <div
          style={{
            position: "absolute",
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.width,
            height: marqueeRect.height,
            border: "1.5px solid #60a5fa",
            background: "rgba(96, 165, 250, 0.08)",
            pointerEvents: "none",
            zIndex: 20,
          }}
        />
      )}

      {/* ── Semantic layer: the visual layers are aria-hidden raster, so this
              is what keyboard and screen-reader users actually operate. */}
      {keyboardNav && (
        <>
          <p id={a11yDescriptionId} style={SR_ONLY_STYLE}>
            {`Graph with ${nodes.length} node${nodes.length === 1 ? "" : "s"} and ${edges.length} edge${edges.length === 1 ? "" : "s"}. `}
            {"Use the arrow keys to move between nodes, Enter or Space to select, "}
            {"Shift with Enter to add to the selection, Alt with the arrow keys to move "}
            {"the selection, and Escape to clear it."}
            {onConnect
              ? " Press C on a node, then Enter on another, to connect them;"
              + " use the bracket keys to choose which ports are used."
              : ""}
            {edges.length > 0 ? " A second list holds the edges." : ""}
          </p>
          <AccessibilityLayer
            nodes={nodes}
            positions={positions}
            selectedNodeIds={effectiveSelection}
            focusedId={keyboardFocusId}
            connectFromId={connectFromId}
            onFocusNode={handleFocusNode}
            onNodeActivate={handleA11yNodeActivate}
            onNodeContextMenu={renderContextMenu ? handleA11yNodeContextMenu : undefined}
            getNodeLabel={getNodeLabel}
            describedById={a11yDescriptionId}
            edges={edges}
            selectedEdgeIds={selectedEdgeIds}
            focusedEdgeId={focusedEdgeId}
            onFocusEdge={handleFocusEdge}
            onBlurEdge={handleBlurEdge}
            onEdgeActivate={handleA11yEdgeActivate}
            onEdgeContextMenu={renderContextMenu ? handleA11yEdgeContextMenu : undefined}
            getEdgeLabel={getEdgeLabel}
            connectHint={connectHint}
          />
        </>
      )}

      {/* ── Edge toolbar (hover, after a dwell delay) */}
      {renderEdgeToolbar && edgeToolbar && (
        <div
          data-gc-chrome
          data-gc-edge-toolbar={edgeToolbar.props.edge.id}
          role="toolbar"
          aria-label={`Actions for edge ${getEdgeLabel?.(edgeToolbar.props.edge) || edgeToolbar.props.edge.id}`}
          style={{
            position: "absolute",
            left: edgeToolbar.screen.x,
            top: edgeToolbar.screen.y,
            transform: "translate(-50%, -50%)",
            zIndex: 25,
            pointerEvents: "auto",
          }}
          // Keep the toolbar alive while the pointer is on it — the edge
          // itself is no longer under the cursor at that point.
          onPointerEnter={() => {
            if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
          }}
          onPointerLeave={() => {
            if (!currentEdgeToolbarHasFocus()) setToolbarEdgeId(null);
          }}
          onFocus={() => {
            if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (!isCurrentEdgeToolbarFocus(next, edgeToolbar.props.edge.id)) {
              setToolbarEdgeId(null);
            }
          }}
        >
          {renderEdgeToolbar(edgeToolbar.props)}
        </div>
      )}

      {/* ── Minimap navigator (bottom-left) */}
      {showMinimap && viewportSize && (
        <MiniMap
          nodes={nodes}
          positions={positions}
          viewport={viewport}
          containerWidth={viewportSize.width}
          containerHeight={viewportSize.height}
          onNavigate={(gx, gy) => panTo(gx, gy, viewport.zoom, false)}
        />
      )}

      {/* ── Fit-to-view button */}
      {showFitView && (
        <button
          type="button"
          data-gc-chrome
          // Belt and braces alongside the container-level chrome checks: stop
          // these from reaching the graph handlers at all.
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            fitToView(filterKnownPositions(positions, nodeById), (id) => {
              const node = nodeById.get(id);
              return node ? resolvedGetNodeRadius(node) : 40;
            });
          }}
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            padding: "5px 10px",
            fontSize: 11,
            background: "#1e293b",
            color: "#94a3b8",
            border: "1px solid #334155",
            borderRadius: 6,
            cursor: "pointer",
            zIndex: 10,
          }}
        >
          Fit view
        </button>
      )}

      {/* ── Zoom controls, stacked above the fit-view button */}
      {showZoomControls && (
        <div
          data-gc-chrome
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: showFitView ? 44 : 12,
            right: 12,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            zIndex: 10,
          }}
        >
          {([
            ["Zoom in", "+", ZOOM_STEP],
            ["Zoom out", "−", 1 / ZOOM_STEP],
          ] as const).map(([label, glyph, factor]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={(e) => {
                e.stopPropagation();
                zoomBy(factor);
              }}
              style={{
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
                fontSize: 14,
                lineHeight: 1,
                background: "#1e293b",
                color: "#94a3b8",
                border: "1px solid #334155",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Public wrapper — creates the per-instance store ────────────────────────

export function GraphCanvas<T = unknown, E = unknown>(
  props: GraphCanvasProps<T, E>
) {
  const storeRef = useRef<ReturnType<typeof createGraphCanvasStore> | null>(null);

  if (!storeRef.current) {
    storeRef.current = createGraphCanvasStore(props.initialPositions ?? {});
  }

  return (
    <GraphCanvasStoreContext.Provider value={storeRef.current}>
      <GraphCanvasInner {...props} />
    </GraphCanvasStoreContext.Provider>
  );
}
