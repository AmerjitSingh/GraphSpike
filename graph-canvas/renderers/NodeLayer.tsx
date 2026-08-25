"use client";

import { memo, useRef, useState, useCallback, useEffect, useMemo } from "react";
import type {
  GraphEdge,
  GraphNode,
  NodePosition,
  NodeRenderProps,
  NodeSize,
  PortDef,
  PortRenderProps,
  PortSide,
} from "../types.js";
import {
  PORT_BAR_HEIGHT,
  PORT_BAR_WIDTH,
  PORT_SIZE,
  getPortGlyph,
  getPortPositions,
  getPortSide,
  resolveNodePorts,
  resolveNodeSize,
  snapValueToGrid,
} from "../ports.js";
import {
  useRawGraphCanvasStore,
} from "../store.js";
import { isInteractiveTarget } from "../interaction.js";
import { DEFAULT_NODE_RADIUS } from "../geometry.js";

const DRAG_START_THRESHOLD = 3; // px movement before drag is committed

// ─── Default node visual ─────────────────────────────────────────────────────

function DefaultNodeContent<T>({ node, isSelected, isHighlighted }: NodeRenderProps<T>) {
  const label = String((node.data as Record<string, unknown>)?.label ?? node.id);
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        // Matches the circle NodeCanvasLayer draws for an unselected node
        // (DEFAULT_NODE_RADIUS 40 -> 80x80). They must agree: selecting a node
        // swaps the canvas circle for this element, and a different size or
        // shape here makes the node visibly jump on every select/deselect.
        // It is also the box DEFAULT_NODE_SIZE lays ports out against.
        width: DEFAULT_NODE_RADIUS * 2,
        height: DEFAULT_NODE_RADIUS * 2,
        boxSizing: "border-box",
        padding: "6px 10px",
        borderRadius: "50%",
        background: isSelected ? "#3b82f6" : "#1e293b",
        border: `2px solid ${isSelected ? "#60a5fa" : "#475569"}`,
        color: isSelected ? "#fff" : "#e2e8f0",
        fontSize: 12,
        fontFamily: "sans-serif",
        lineHeight: 1.4,
        textAlign: "center",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        overflow: "hidden",
        boxShadow: isHighlighted
          ? "0 0 0 3px #f59e0b"
          : isSelected
            ? "0 0 0 3px rgba(59,130,246,0.3)"
            : "0 1px 4px rgba(0,0,0,0.4)",
        transition: "background 0.12s, border-color 0.12s",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

// ─── Default port visual ─────────────────────────────────────────────────────

/**
 * Circle for the primary flow type, diamond for everything else — the same
 * convention that makes typed sub-connections readable at a glance
 * without needing colour.
 */
function DefaultPort<T>({ port, isSnapTarget, isConnected }: PortRenderProps<T>) {
  const glyph = getPortGlyph(port);
  const accent = isSnapTarget ? "#22c55e" : "#64748b";
  return (
    <div
      style={{
        width: glyph === "bar" ? PORT_BAR_WIDTH : PORT_SIZE,
        height: glyph === "bar" ? PORT_BAR_HEIGHT : PORT_SIZE,
        boxSizing: "border-box",
        transform: glyph === "diamond" ? "rotate(45deg)" : undefined,
        borderRadius: glyph === "circle" ? "50%" : 2,
        background: isConnected || isSnapTarget ? accent : "#fff",
        border: `1.5px solid ${accent}`,
        boxShadow: isSnapTarget ? `0 0 0 4px ${accent}33` : undefined,
        transition: "background 0.12s, border-color 0.12s, box-shadow 0.12s",
      }}
    />
  );
}

/** Where a port's label sits relative to the port dot, per side. */
const PORT_LABEL_OFFSET: Record<PortSide, React.CSSProperties> = {
  top: { bottom: "100%", marginBottom: 4, transform: "translateX(-50%)", left: "50%" },
  bottom: { top: "100%", marginTop: 4, transform: "translateX(-50%)", left: "50%" },
  left: { right: "100%", marginRight: 5, transform: "translateY(-50%)", top: "50%" },
  right: { left: "100%", marginLeft: 5, transform: "translateY(-50%)", top: "50%" },
};

const PORT_STUB_BORDER = "1.5px dotted #cbd5e1";
const portConnectionKey = (nodeId: string, portId: string) => JSON.stringify([nodeId, portId]);

// Outward bands measured from the port's edge. Deriving all three from the same
// numbers is what keeps the label out of the stub: the stub starts only after
// the label band ends, so the dotted line can never be drawn through the text.
/** Where the label sits. */
export const PORT_LABEL_GAP = 4;
/** Height reserved for the label text (fontSize 9, lineHeight 1, plus slack). */
const PORT_LABEL_BAND = 12;
/** Where the stub begins — clear of the label. */
const PORT_STUB_START = PORT_LABEL_GAP + PORT_LABEL_BAND; // 16
/** How far the stub runs. */
const PORT_STUB_LENGTH = 12;
/** Where the endpoint sits — at the far end of the stub. */
const PORT_ENDPOINT_GAP = PORT_STUB_START + PORT_STUB_LENGTH; // 28

const PORT_ENDPOINT_SIZE = 16;

/** Where the endpoint affordance sits relative to the port dot, per side. */
const PORT_ADD_OFFSET: Record<PortSide, React.CSSProperties> = {
  top: { bottom: "100%", marginBottom: PORT_ENDPOINT_GAP, left: "50%", translate: "-50% 0" },
  bottom: { top: "100%", marginTop: PORT_ENDPOINT_GAP, left: "50%", translate: "-50% 0" },
  left: { right: "100%", marginRight: PORT_ENDPOINT_GAP, top: "50%", translate: "0 -50%" },
  right: { left: "100%", marginLeft: PORT_ENDPOINT_GAP, top: "50%", translate: "0 -50%" },
};

/** The stub joining a port to its endpoint affordance, so the two read as one
 *  control rather than a dot with a stray button.
 *
 *  Dotted rather than solid: a solid bar reads as a *connection*, which this is
 *  not. Drawn as a dotted border on a zero-thickness box so the dots stay crisp
 *  at any zoom, which a gradient fill would not. */
const PORT_STUB_STYLE: Record<PortSide, React.CSSProperties> = {
  top: { bottom: "100%", marginBottom: PORT_STUB_START, left: "50%", width: 0, height: PORT_STUB_LENGTH, borderLeft: PORT_STUB_BORDER, translate: "-50% 0" },
  bottom: { top: "100%", marginTop: PORT_STUB_START, left: "50%", width: 0, height: PORT_STUB_LENGTH, borderLeft: PORT_STUB_BORDER, translate: "-50% 0" },
  left: { right: "100%", marginRight: PORT_STUB_START, top: "50%", width: PORT_STUB_LENGTH, height: 0, borderTop: PORT_STUB_BORDER, translate: "0 -50%" },
  right: { left: "100%", marginLeft: PORT_STUB_START, top: "50%", width: PORT_STUB_LENGTH, height: 0, borderTop: PORT_STUB_BORDER, translate: "0 -50%" },
};

/** Does this port offer a drag-to-connect source?
 *  Inputs never do: a connection leaves through an output, so `validation.ts`
 *  would reject anything dragged from an input. Advertising a crosshair and a
 *  drag handle on one is a dead affordance. */
function isDragSource(port: PortDef, canConnect: boolean): boolean {
  if (!canConnect) return false;
  if (port.mode !== "output") return false;
  return (port.behavior ?? "drag") !== "menu";
}

/** Does this port show the click-to-create endpoint? */
function hasEndpoint(port: PortDef): boolean {
  const behavior = port.behavior ?? "drag";
  return behavior === "menu" || behavior === "both";
}

// ─── Single draggable node ────────────────────────────────────────────────────

interface GraphNodeItemProps<T> {
  node: GraphNode<T>;
  position: NodePosition;
  isSelected: boolean;
  isHighlighted: boolean;
  isFocused: boolean;
  isConnectSource: boolean;
  zoom: number;
  renderNode?: (props: NodeRenderProps<T>) => React.ReactNode;
  renderPort?: (props: PortRenderProps<T>) => React.ReactNode | null;
  /** Ports to render on this node, already resolved by the layer. */
  ports: PortDef[];
  size: NodeSize;
  /** Port ids on this node that already have at least one edge. */
  connectedPortIds: Set<string>;
  /** Port on this node the in-flight drag would land on. */
  snapPortId?: string;
  isConnecting: boolean;
  onMoveStart: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd: (id: string, x: number, y: number) => void;
  /** Abandon an in-flight drag, restoring the pre-drag position. */
  onMoveCancel: (id: string, x: number, y: number) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
  onDoubleClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  onPortContextMenu?: (
    id: string,
    e: React.MouseEvent,
    port?: PortDef,
    graphAnchor?: NodePosition
  ) => void;
  onConnectStart?: (
    id: string,
    x: number,
    y: number,
    portId: string | undefined,
    pointerId: number
  ) => void;
  snapToGrid?: number;
  /** False while the canvas owns left-drag (panOnDrag, or space held). A
   *  promoted node must not keep dragging when its unselected twin pans. */
  nodeDragEnabled?: boolean;
  /** False while space is held. Space-drag is an explicit, global pan, so a
   *  press on a port must not also begin a connection. */
  connectEnabled?: boolean;
  /** Imperative cancellation slot used when a second touch turns the gesture
   * into a pinch. Only the currently dragged HTML node registers here. */
  activeDragCancelRef?: React.MutableRefObject<((pointerId?: number) => void) | null>;
}

const GraphNodeItem = memo(function GraphNodeItem<T>({
  node,
  position,
  isSelected,
  isHighlighted,
  isFocused,
  isConnectSource,
  zoom,
  renderNode,
  renderPort,
  ports,
  size,
  connectedPortIds,
  snapPortId,
  isConnecting,
  onMoveStart,
  onMove,
  onMoveEnd,
  onMoveCancel,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPortContextMenu,
  onConnectStart,
  snapToGrid,
  nodeDragEnabled = true,
  connectEnabled = true,
  activeDragCancelRef,
}: GraphNodeItemProps<T>) {
  const elRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStart = useRef({ clientX: 0, clientY: 0, nodeX: 0, nodeY: 0, pointerId: -1 });
  const [isDragging, setIsDragging] = useState(false);

  const armClickSuppression = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 0);
  }, []);

  // If this node unmounts mid-drag (deleted, or dropped from the active layer
  // by a selection change), close out the drag anyway — otherwise the store's
  // transient depth never returns to zero and onPositionsChange stays muted.
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const positionRef = useRef(position);
  positionRef.current = position;
  const cancelActiveDrag = useCallback(function cancelThisDrag(pointerId?: number) {
    if (
      pointerId !== undefined &&
      (!dragging.current || pointerId !== dragStart.current.pointerId)
    ) return;
    if (activeDragCancelRef?.current === cancelThisDrag) {
      activeDragCancelRef.current = null;
    }
    const wasDragging = dragging.current;
    const wasMoved = moved.current;
    dragging.current = false;
    moved.current = false;
    setIsDragging(false);
    try {
      elRef.current?.releasePointerCapture(dragStart.current.pointerId);
    } catch {
      // Capture is released automatically when the pointer disappears. Some
      // browsers throw if cancellation races that automatic release.
    }
    if (wasDragging && wasMoved) {
      onMoveCancel(node.id, dragStart.current.nodeX, dragStart.current.nodeY);
    }
  }, [activeDragCancelRef, node.id, onMoveCancel]);

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
      if (activeDragCancelRef?.current === cancelActiveDrag) {
        activeDragCancelRef.current = null;
      }
      if (dragging.current && moved.current) {
        dragging.current = false;
        moved.current = false;
        const p = positionRef.current;
        onMoveEndRef.current(node.id, p.x, p.y);
      }
    };
  }, [activeDragCancelRef, cancelActiveDrag, node.id]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Contact two belongs to pinch zoom. Let it bubble to GraphCanvas, which
      // cancels the first contact's owner before d3 accepts the touchstart.
      if (e.pointerType === "touch" && !e.isPrimary) return;
      // Primary is scoped per pointer type. Refuse a second pen/touch/mouse
      // press while any promoted node already owns a drag in this graph.
      if (dragging.current || activeDragCancelRef?.current) return;

      // Interactive content wins over everything, including the connect drag.
      // This has to be checked *before* the handle lookup: controls the library
      // renders for a port (the menu endpoint) and anything a consumer puts in
      // `renderPort` live inside the [data-gc-handle] wrapper, so checking the
      // handle first would start a connect drag — and paint a preview line —
      // the moment you pressed a button that was only ever meant to be clicked.
      if (isInteractiveTarget(e.target)) return;

      // Handle clicks on any [data-gc-handle] element — covers both the
      // library-managed wrapper and port elements inside renderNode.
      const handleEl = (e.target as HTMLElement).closest("[data-gc-handle]");
      if (handleEl instanceof HTMLElement) {
        // Let the press fall through to the canvas so pan mode gets it,
        // instead of panning and drawing a connection from one gesture.
        if (!connectEnabled) return;
        if (!onConnectStart) return;
        e.stopPropagation();
        e.preventDefault();
        const portId = handleEl.getAttribute("data-gc-port") ?? undefined;
        const nodeRect = elRef.current?.getBoundingClientRect();
        const handleRect = handleEl.getBoundingClientRect();
        if (!nodeRect) {
          onConnectStart(node.id, position.x, position.y, portId, e.pointerId);
          return;
        }
        const nodeCenterX = nodeRect.left + nodeRect.width / 2;
        const nodeCenterY = nodeRect.top + nodeRect.height / 2;
        const handleCenterX = handleRect.left + handleRect.width / 2;
        const handleCenterY = handleRect.top + handleRect.height / 2;
        onConnectStart(
          node.id,
          position.x + (handleCenterX - nodeCenterX) / zoom,
          position.y + (handleCenterY - nodeCenterY) / zoom,
          portId,
          e.pointerId
        );
        return;
      }

      // Pan mode owns the gesture. Without this a selected node drags while an
      // unselected one pans — the same press doing two different things
      // depending on selection.
      if (!nodeDragEnabled) return;

      e.stopPropagation();
      e.preventDefault();
      dragging.current = true;
      moved.current = false;
      dragStart.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        nodeX: position.x,
        nodeY: position.y,
        pointerId: e.pointerId,
      };
      elRef.current?.setPointerCapture(e.pointerId);
      if (activeDragCancelRef) activeDragCancelRef.current = cancelActiveDrag;
    },
    [
      activeDragCancelRef,
      cancelActiveDrag,
      node.id,
      position.x,
      position.y,
      zoom,
      onConnectStart,
      nodeDragEnabled,
      connectEnabled,
    ]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || e.pointerId !== dragStart.current.pointerId) return;
      const screenDx = e.clientX - dragStart.current.clientX;
      const screenDy = e.clientY - dragStart.current.clientY;
      const dx = screenDx / zoom;
      const dy = screenDy / zoom;
      if (!moved.current) {
        if (Math.hypot(screenDx, screenDy) < DRAG_START_THRESHOLD) return;
        moved.current = true;
        setIsDragging(true);
        onMoveStart(node.id);
      }
      // Snap the resolved position rather than the delta, so a node that began
      // off-grid lands on the grid instead of staying permanently offset.
      onMove(
        node.id,
        snapValueToGrid(dragStart.current.nodeX + dx, snapToGrid),
        snapValueToGrid(dragStart.current.nodeY + dy, snapToGrid)
      );
    },
    [node.id, zoom, onMove, onMoveStart, snapToGrid]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || e.pointerId !== dragStart.current.pointerId) return;
      const wasDragging = dragging.current;
      const wasMoved = moved.current;
      dragging.current = false;
      moved.current = false;
      setIsDragging(false);
      if (activeDragCancelRef?.current === cancelActiveDrag) {
        activeDragCancelRef.current = null;
      }
      elRef.current?.releasePointerCapture(e.pointerId);

      if (wasDragging && wasMoved) {
        // A pointer sequence normally emits click immediately after pointerup.
        // Keep that compatibility click from selecting a node the drag already
        // acted on, but clear the guard on the next task if this browser emits
        // no click for a moved pointer.
        armClickSuppression();
        onMoveEnd(node.id, position.x, position.y);
      }
    },
    [
      activeDragCancelRef,
      cancelActiveDrag,
      node.id,
      position.x,
      position.y,
      onMoveEnd,
      armClickSuppression,
    ]
  );

  const onNodeClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
        e.stopPropagation();
        return;
      }
      // A control or port owns its click; it must not also select the node.
      if (isInteractiveTarget(e.target)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-gc-handle]")) return;
      e.stopPropagation();
      onClick(node.id, e);
    },
    [node.id, onClick]
  );

  /**
   * A cancelled pointer is not a completed one. The browser fires
   * `pointercancel` for palm rejection, a gesture takeover, or the OS stealing
   * the pointer — treating that as a pointerup committed the move (firing
   * `onNodeMove` and `onPositionsChange`) or, for a press that never moved,
   * changed the selection. Both are actions the user never asked for, so undo
   * the drag instead.
   */
  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== dragStart.current.pointerId) return;
    cancelActiveDrag(e.pointerId);
  }, [cancelActiveDrag]);

  const onDblClick = useCallback(
    (e: React.MouseEvent) => {
      // A double-click on a control the consumer rendered belongs to that
      // control — selecting a word in a text field must not also fire the
      // node's double-click action.
      if (isInteractiveTarget(e.target)) return;
      e.stopPropagation();
      onDoubleClick(node.id, e);
    },
    [node.id, onDoubleClick]
  );

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onContextMenu) return;
      // Likewise: right-clicking an input should offer the browser's own
      // editing menu, not the graph's.
      if (isInteractiveTarget(e.target)) {
        // Keep the native default, but do not let the graph container replace
        // it with a spatially hit-tested node/canvas menu.
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(node.id, e);
    },
    [node.id, onContextMenu]
  );

  const renderProps: NodeRenderProps<T> = {
    node, isSelected, isHighlighted, isDragging, isFocused, isConnectSource, zoom,
  };
  const content = renderNode ? renderNode(renderProps) : <DefaultNodeContent {...renderProps} />;

  // Ports are positioned against the node's declared box rather than its
  // rendered DOM size, so they line up exactly with the anchor points the
  // edge layer and the spatial index compute from the same numbers.
  const portPositions = useMemo(
    () => getPortPositions({ x: 0, y: 0 }, size, ports),
    [size, ports]
  );

  return (
    // The separate AccessibilityLayer is the keyboard-operable semantic mirror
    // for this visual node; making both layers tabbable would duplicate it.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={elRef}
      data-gc-node={node.id}
      style={{
        position: "absolute",
        transform: `translate(${position.x}px, ${position.y}px) translate(-50%, -50%) scale(${isDragging ? 1.04 : 1})`,
        transformOrigin: "center center",
        transition: isDragging ? "none" : "transform 0.08s ease",
        zIndex: isFocused ? 3 : isSelected ? 2 : 1,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        // Drawn on the wrapper rather than inside DefaultNodeContent so a
        // custom `renderNode` still shows keyboard focus.
        outline: isFocused ? "2px solid #f8fafc" : undefined,
        outlineOffset: isFocused ? 3 : undefined,
        borderRadius: isFocused ? "50%" : undefined,
        boxShadow: isConnectSource ? "0 0 0 3px #22d3ee" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onNodeClick}
      onDoubleClick={onDblClick}
      onContextMenu={onNodeContextMenu}
    >
      {content}

      {/* Ports — positioned by the library from the port registry, so the
          visual, the edge anchor, and the hit-box all agree. */}
      {/* Ports render whenever the node declares them. Gating this on
          `onConnectStart` hid read-only and menu-only ports the moment a node
          was selected (promoting it into this layer), which also made the
          port context menu unreachable in a read-only graph. */}
      {ports.map((port) => {
          const offset = portPositions.get(port.id);
          if (!offset) return null;
          const side = getPortSide(port);
          const isSnapTarget = snapPortId === port.id;
          const portProps: PortRenderProps<T> = {
            node,
            port,
            side,
            isConnecting,
            isSnapTarget,
            isConnected: connectedPortIds.has(port.id),
            zoom,
          };
          const portContent = renderPort ? renderPort(portProps) : <DefaultPort {...portProps} />;
          if (portContent === null) return null;

          const draggable = isDragSource(port, Boolean(onConnectStart));
          // A dead affordance is worse than none: the endpoint's only job is to
          // open the port menu, so it needs a menu renderer to open into.
          const showEndpoint = hasEndpoint(port) && Boolean(onPortContextMenu);

          return (
            <div
              key={port.id}
              // Presence of this attribute is what makes a port a drag source —
              // the pointerdown path keys off it, so a menu-only port simply
              // omits it and becomes undraggable with no special-casing.
              {...(draggable ? { "data-gc-handle": true } : {})}
              data-gc-port={port.id}
              title={
                draggable
                  ? port.label ? `Drag to connect: ${port.label}` : "Drag to connect"
                  : port.label
              }
              onContextMenu={
                onPortContextMenu
                  ? (e) => {
                      if (isInteractiveTarget(e.target)) {
                        // A consumer-rendered input/button keeps its native
                        // menu, while the event stops before graph hit-testing.
                        e.stopPropagation();
                        return;
                      }
                      e.stopPropagation();
                      e.preventDefault();
                      onPortContextMenu(node.id, e, port);
                    }
                  : undefined
              }
              style={{
                position: "absolute",
                left: `calc(50% + ${offset.x}px)`,
                top: `calc(50% + ${offset.y}px)`,
                transform: "translate(-50%, -50%)",
                cursor: draggable ? "crosshair" : "default",
                display: "grid",
                placeItems: "center",
                touchAction: "none",
              }}
            >
              {portContent}
              {port.label && (
                <span
                  style={{
                    position: "absolute",
                    // Labels sit outside the node on the port's own side.
                    // Note there is no zoom counter-scaling here: the label
                    // belongs to the node and scales with it. Compensating for
                    // zoom keeps the text a fixed screen size, which means it
                    // grows relative to the node as you zoom out until adjacent
                    // port labels collide.
                    ...PORT_LABEL_OFFSET[side],
                    fontSize: 9,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    color: "#94a3b8",
                    pointerEvents: "none",
                  }}
                >
                  {port.label}
                  {port.required && <span style={{ color: "#ef4444" }}>*</span>}
                </span>
              )}
              {showEndpoint && (
                <>
                  {/* Stub joining the port to the endpoint, so the two read as
                      one control rather than a dot with a stray button. */}
                  <div
                    style={{
                      position: "absolute",
                      ...PORT_STUB_STYLE[side],
                      pointerEvents: "none",
                    }}
                  />
                  <button
                    type="button"
                    // Opt out of node dragging: without this, pressing the
                    // endpoint would start moving the node underneath it.
                    data-gc-no-drag
                    aria-label={`Add node on ${port.label ?? port.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Reuse the managed port context menu rather than
                      // inventing a second menu: it already handles placement,
                      // Escape, outside-click and viewport-change dismissal.
                      onPortContextMenu?.(node.id, e, port, {
                        x: position.x + offset.x,
                        y: position.y + offset.y,
                      });
                    }}
                    style={{
                      position: "absolute",
                      ...PORT_ADD_OFFSET[side],
                      // Deliberately NOT counter-scaled. The label is text that
                      // has to stay legible, but this is a shape sitting among
                      // other shapes — compensating for zoom makes it grow out
                      // of proportion with the port glyphs it belongs to.
                      width: PORT_ENDPOINT_SIZE,
                      height: PORT_ENDPOINT_SIZE,
                      boxSizing: "border-box",
                      display: "grid",
                      placeItems: "center",
                      padding: 0,
                      borderRadius: 4,
                      border: "1.5px solid #cbd5e1",
                      background: "#fff",
                      color: "#64748b",
                      fontSize: 12,
                      lineHeight: 1,
                      cursor: "pointer",
                    }}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}) as <T>(props: GraphNodeItemProps<T>) => React.ReactElement | null;

// ─── Layer ────────────────────────────────────────────────────────────────────

interface NodeLayerProps<T> {
  nodes: GraphNode<T>[];
  nodeById: Map<string, GraphNode<T>>;
  positions: Record<string, NodePosition>;
  selectedNodeIds: string[];
  /** Ids to render highlighted (e.g. cross-graph linking). Independent of
   *  selection — a node can be both. */
  highlightedNodeIds?: string[];
  /** Node holding the roving keyboard focus, so it can be shown as focused. */
  focusedNodeId?: string | null;
  /** Node a keyboard connect was armed from. */
  connectFromId?: string | null;
  /** False while the canvas owns left-drag (panOnDrag, or space held). */
  nodeDragEnabled?: boolean;
  /** False while space is held, so a port press doesn't also pan. */
  connectEnabled?: boolean;
  /** Current HTML node drag's cancellation callback, used by pinch takeover. */
  activeDragCancelRef?: React.MutableRefObject<((pointerId?: number) => void) | null>;
  zoom: number;
  renderNode?: (props: NodeRenderProps<T>) => React.ReactNode;
  renderPort?: (props: PortRenderProps<T>) => React.ReactNode | null;
  getNodePorts?: (node: GraphNode<T>) => PortDef[];
  getNodeSize?: (node: GraphNode<T>) => NodeSize;
  /** Used to mark ports that already carry an edge. */
  edges?: GraphEdge<unknown>[];
  /** In-flight connect drag, so ports can show a snap-target state. */
  dragLine?: { snapId: string | null; snapPort?: string } | null;
  onNodeMove?: (id: string, x: number, y: number) => void;
  onNodeClick?: (id: string, event: React.MouseEvent) => void;
  onNodeDoubleClick?: (id: string, event: React.MouseEvent) => void;
  onNodeContextMenu?: (id: string, event: React.MouseEvent) => void;
  onPortContextMenu?: (
    id: string,
    event: React.MouseEvent,
    port?: PortDef,
    graphAnchor?: NodePosition
  ) => void;
  onConnectStart?: (
    id: string,
    x: number,
    y: number,
    portId: string | undefined,
    pointerId: number
  ) => void;
  activeOnly?: boolean;
  /** Which nodes get a DOM body when `activeOnly` is set. Defaults to the whole
   *  selection; `GraphCanvas` narrows it to a viewport-culled, budgeted subset
   *  and hands `NodeCanvasLayer` the same list to skip. */
  promotedNodeIds?: string[];
  /** Reports the node this layer is dragging (null when it stops), so the owner
   *  can keep it promoted even if the pointer carries it off screen. */
  onActiveDragChange?: (id: string | null) => void;
  snapToGrid?: number;
}

export const NodeLayer = memo(function NodeLayer<T>({
  nodes,
  nodeById,
  positions,
  selectedNodeIds,
  highlightedNodeIds,
  focusedNodeId,
  connectFromId,
  nodeDragEnabled,
  connectEnabled,
  activeDragCancelRef,
  zoom,
  renderNode,
  renderPort,
  getNodePorts,
  getNodeSize,
  edges,
  dragLine,
  onNodeMove,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onPortContextMenu,
  onConnectStart,
  activeOnly = false,
  promotedNodeIds,
  onActiveDragChange,
  snapToGrid,
}: NodeLayerProps<T>) {
  const store = useRawGraphCanvasStore();
  // Keep promoted-node drag ownership graph-wide even when NodeLayer is used
  // directly without GraphCanvas's pinch-cancellation ref.
  const localActiveDragCancelRef = useRef<((pointerId?: number) => void) | null>(null);
  const resolvedActiveDragCancelRef = activeDragCancelRef ?? localActiveDragCancelRef;
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const highlightedSet = useMemo(
    () => (highlightedNodeIds ? new Set(highlightedNodeIds) : null),
    [highlightedNodeIds]
  );

  // Collision-proof tuple keys for every port that already carries an edge.
  const connectedPorts = useMemo(() => {
    const result = new Set<string>();
    if (!edges) return result;
    for (const edge of edges) {
      if (edge.sourcePort) result.add(portConnectionKey(edge.source, edge.sourcePort));
      if (edge.targetPort) result.add(portConnectionKey(edge.target, edge.targetPort));
    }
    return result;
  }, [edges]);

  const activeNodes = useMemo(() => {
    if (!activeOnly) return nodes;
    const result: GraphNode<T>[] = [];
    for (const id of promotedNodeIds ?? selectedNodeIds) {
      const n = nodeById.get(id);
      if (n) result.push(n);
    }
    return result;
  }, [activeOnly, promotedNodeIds, selectedNodeIds, nodes, nodeById]);

  // Per-node port data, resolved once per structural change rather than per
  // render. `GraphNodeItem` is memoised, but building these inline handed it
  // three fresh objects every time — so the memo never held, and under
  // `renderAllNodes` every node re-rendered its whole port subtree on every
  // simulation tick and every drag frame. Positions are deliberately not an
  // input here: `clonePositions` preserves the point objects it doesn't touch,
  // so an undragged node's `position` prop is already reference-stable.
  const portData = useMemo(() => {
    const result = new Map<
      string,
      { ports: PortDef[]; size: NodeSize; connectedPortIds: Set<string> }
    >();
    for (const node of activeNodes) {
      const ports = resolveNodePorts(node, getNodePorts);
      const connectedPortIds = new Set<string>();
      for (const port of ports) {
        if (connectedPorts.has(portConnectionKey(node.id, port.id))) {
          connectedPortIds.add(port.id);
        }
      }
      result.set(node.id, {
        ports,
        size: resolveNodeSize(node, getNodeSize),
        connectedPortIds,
      });
    }
    return result;
  }, [activeNodes, getNodePorts, getNodeSize, connectedPorts]);

  // Captures the initial positions of all group-dragged peers at drag start.
  const groupDragRef = useRef<{
    draggedId: string;
    startX: number;
    startY: number;
    peerInitial: Record<string, NodePosition>;
  } | null>(null);

  const handleMoveStart = useCallback(
    (id: string) => {
      // Every drag is a transient phase — suppresses onPositionsChange
      // until handleMoveEnd fires (or the drag is cancelled).
      store.getState().beginTransient();
      // Pin this node's promotion for the duration of the drag: its element
      // owns the pointer capture, so being culled mid-drag would unmount it and
      // commit the move early.
      onActiveDragChange?.(id);

      const peers = store.getState().selectedNodeIds;
      const peersSet = new Set(peers);
      if (!peersSet.has(id) || peers.length <= 1) {
        groupDragRef.current = null;
        return;
      }
      const pos = store.getState().positions;
      const startPos = pos[id];
      if (!startPos) { groupDragRef.current = null; return; }
      const peerInitial = Object.create(null) as Record<string, NodePosition>;
      for (const nid of peers) {
        if (nid !== id && pos[nid]) peerInitial[nid] = { ...pos[nid] };
      }
      groupDragRef.current = { draggedId: id, startX: startPos.x, startY: startPos.y, peerInitial };
    },
    [store, onActiveDragChange]
  );

  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      // A node deleted mid-drag has no position; writing one for it (or for a
      // deleted peer) would resurrect it in the store, and the orphan entry
      // would then leak into onPositionsChange. Same guards as
      // useCanvasNodeDrag.
      const live = store.getState().positions;
      if (!live[id]) return;
      const drag = groupDragRef.current;
      if (drag && drag.draggedId === id) {
        // Move the dragged node and all peers by the same delta.
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        const updates: { id: string; x: number; y: number }[] = [{ id, x, y }];
        for (const [nid, p] of Object.entries(drag.peerInitial)) {
          if (!live[nid]) continue;
          updates.push({ id: nid, x: p.x + dx, y: p.y + dy });
        }
        store.getState().setNodePositions(updates);
      } else {
        store.getState().setNodePosition(id, x, y);
      }
    },
    [store]
  );

  const handleMoveEnd = useCallback(
    (id: string, x: number, y: number) => {
      onActiveDragChange?.(null);
      // A node deleted mid-drag (this also covers the unmount-commit path in
      // GraphNodeItem) has no position; reporting a move for it would hand the
      // consumer an id it has already removed. Same guard as useCanvasNodeDrag.
      const pos = store.getState().positions;
      const drag = groupDragRef.current;
      if (drag && drag.draggedId === id) {
        // Notify onNodeMove for every node that moved as part of the group.
        if (pos[id]) onNodeMove?.(id, x, y);
        for (const nid of Object.keys(drag.peerInitial)) {
          const p = pos[nid];
          if (p) onNodeMove?.(nid, p.x, p.y);
        }
        groupDragRef.current = null;
      } else if (pos[id]) {
        onNodeMove?.(id, x, y);
      }
      // Exit the transient phase; usePositionSync will flush onPositionsChange.
      store.getState().endTransient();
    },
    [store, onNodeMove, onActiveDragChange]
  );

  const handleMoveCancel = useCallback(
    (id: string, x: number, y: number) => {
      onActiveDragChange?.(null);
      // Restore only nodes that still exist — recreating a position for one
      // deleted mid-drag would resurrect it. Same guard as useCanvasNodeDrag.
      const live = store.getState().positions;
      const drag = groupDragRef.current;
      if (drag && drag.draggedId === id) {
        const updates = [{ id, x, y }];
        for (const [nid, p] of Object.entries(drag.peerInitial)) {
          updates.push({ id: nid, x: p.x, y: p.y });
        }
        const restore = updates.filter((u) => live[u.id]);
        if (restore.length > 0) store.getState().setNodePositions(restore);
        groupDragRef.current = null;
      } else if (live[id]) {
        store.getState().setNodePosition(id, x, y);
      }
      // Close the transient opened by handleMoveStart. No onNodeMove: nothing
      // ended up moving.
      store.getState().endTransient();
    },
    [store, onActiveDragChange]
  );

  const handleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        store.getState().toggleSelection(id);
      } else {
        store.getState().setSelection([id]);
      }
      onNodeClick?.(id, e);
    },
    [store, onNodeClick]
  );

  const handleDoubleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      onNodeDoubleClick?.(id, e);
    },
    [onNodeDoubleClick]
  );

  return (
    <>
      {activeNodes.map((node) => {
        const pos = positions[node.id];
        if (!pos) return null;
        const nodePorts = portData.get(node.id);
        if (!nodePorts) return null;
        return (
          <GraphNodeItem
            key={node.id}
            node={node}
            position={pos}
            isSelected={selectedSet.has(node.id)}
            isHighlighted={highlightedSet?.has(node.id) ?? false}
            isFocused={focusedNodeId === node.id}
            isConnectSource={connectFromId === node.id}
            nodeDragEnabled={nodeDragEnabled}
            connectEnabled={connectEnabled}
            activeDragCancelRef={resolvedActiveDragCancelRef}
            zoom={zoom}
            renderNode={renderNode as ((props: NodeRenderProps<unknown>) => React.ReactNode) | undefined}
            renderPort={renderPort as ((props: PortRenderProps<unknown>) => React.ReactNode | null) | undefined}
            ports={nodePorts.ports}
            size={nodePorts.size}
            connectedPortIds={nodePorts.connectedPortIds}
            snapPortId={dragLine?.snapId === node.id ? dragLine.snapPort : undefined}
            isConnecting={Boolean(dragLine)}
            onMoveStart={handleMoveStart}
            onMove={handleMove}
            onMoveEnd={handleMoveEnd}
            onMoveCancel={handleMoveCancel}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={onNodeContextMenu}
            onPortContextMenu={onPortContextMenu}
            onConnectStart={onConnectStart}
            snapToGrid={snapToGrid}
          />
        );
      })}
    </>
  );
}) as <T>(props: NodeLayerProps<T>) => React.ReactElement | null;
