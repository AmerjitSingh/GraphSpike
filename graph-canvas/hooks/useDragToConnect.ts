"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNodeAnchor as resolveNodeAnchor } from "../geometry.js";
import type { PortAnchorResolver } from "../geometry.js";
import type {
  Connection,
  GraphNode,
  NodeAnchorProps,
  NodePosition,
  Viewport,
} from "../types.js";
import type { SpatialIndex } from "../spatialIndex.js";
import { resolveExternalDropHandler } from "../link/GraphLink.js";
import type { GraphLink, GraphLinkRegistration } from "../link/GraphLink.js";

/** Snap radius for whole nodes, in screen pixels before zoom division. */
const NODE_SNAP_RADIUS_PX = 60;
/** Ports are smaller targets than nodes, so they get a tighter radius —
 *  otherwise a node-centre hit would win over the port the user aimed at. */
const PORT_SNAP_RADIUS_PX = 34;

export interface DragLineState {
  sourceId: string;
  sourcePort?: string;
  source: NodePosition;
  target: NodePosition;
  snapId: string | null;
  /** Port on the snap target the drag would land on, when one was hit. */
  snapPort?: string;
  /** False when a target is snapped but the connection is rejected. Lets the
   *  preview line render an invalid state instead of silently no-op'ing on drop. */
  isValid: boolean;
}

interface UseDragToConnectProps<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  positions: Record<string, NodePosition>;
  nodeById: Map<string, GraphNode<T>>;
  spatialIndex: React.RefObject<SpatialIndex<T>>;
  resolvedGetNodeRadius: (node: GraphNode<T>) => number;
  getNodeAnchor?: (props: NodeAnchorProps<T>) => NodePosition;
  onConnect?: (connection: Connection) => void;
  /** Called at the start of a drag (e.g. to close any open context menu). */
  onDragStart?: () => void;
  // ── Ports
  portResolver?: PortAnchorResolver<T>;
  /** The graph's shared connection validator (see `validation.ts`). Every path
   *  that can create an edge runs through the same instance, so the drag
   *  preview and the keyboard commit can't disagree. */
  validateConnection?: (connection: Connection) => boolean;
  // ── Cross-graph drag
  /** Resolved link (or null) — used to find a drop target in another graph. */
  link?: GraphLink | null;
  /** This graph's id within the link group. */
  graphId?: string;
  /** Allow the connector drag to drop onto another linked graph. */
  crossGraphDrag?: boolean;
  /** Map a local node id to its shared cross-graph key. */
  toKey?: (id: string) => string | null;
}

/**
 * Walk up from the element under the pointer to the nearest graph container.
 * Independent of pointer capture (elementFromPoint is a document hit-test), so
 * it resolves the drop target even while the source graph holds capture.
 * Returns the foreign graph's registration, or null when over our own graph.
 */
function resolveForeignRegistration(
  clientX: number,
  clientY: number,
  link: GraphLink | null | undefined,
  selfGraphId: string | undefined,
  selfContainer: HTMLElement | null
): GraphLinkRegistration | null {
  if (!link || !selfGraphId) return null;
  let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  while (el) {
    // Landed inside our own graph — a local drop, not a hand-off.
    if (el === selfContainer) return null;
    const gid = el.getAttribute?.("data-gc-graph-id");
    if (gid && gid !== selfGraphId) {
      const reg = link.getRegistration(gid);
      // The id is only a DOM string: another link group (or a graph that isn't
      // participating) can reuse it. Accept the registration only when its own
      // container is the element we actually walked up through.
      if (reg && reg.getContainer() === el) return reg;
    }
    // Otherwise keep walking — an unregistered or foreign-group id must not
    // shadow an enclosing graph that legitimately owns this point.
    el = el.parentElement;
  }
  return null;
}

/** Used when no validator is wired in; `GraphCanvas` always supplies one. */
const ALLOW_ALL = () => true;

/**
 * Manages the drag-to-connect interaction: tracks the drag line from a port or
 * connector handle to a snap target, and fires `onConnect` on pointer up.
 *
 * Snapping prefers ports over whole nodes, which is what lets `targetPort` be
 * resolved. Because ports are hit-tested through the spatial index rather than
 * the DOM, this works for canvas-rendered nodes too.
 */
export function useDragToConnect<T>({
  containerRef,
  viewport,
  positions,
  nodeById,
  spatialIndex,
  resolvedGetNodeRadius,
  getNodeAnchor,
  onConnect,
  onDragStart,
  portResolver,
  validateConnection,
  link,
  graphId,
  crossGraphDrag = false,
  toKey,
}: UseDragToConnectProps<T>) {
  const [dragLine, setDragLine] = useState<DragLineState | null>(null);

  // Keep a ref mirror of dragLine so pointer-move and pointer-up callbacks
  // can read the latest value without having dragLine as a dependency
  // (which would recreate the callbacks on every pointer move).
  const dragLineRef = useRef<DragLineState | null>(null);

  // The pointer that began the connection owns the whole sequence. `isPrimary`
  // is only primary per pointer type, so concurrent pen + touch input still
  // needs an explicit id check rather than a primary-pointer check.
  const activePointerIdRef = useRef<number | null>(null);

  // Whether the active connect drag has captured its pointer to the container.
  const capturedRef = useRef(false);

  // Set when a captured drag ends, so the click the browser retargets to the
  // container afterwards can be ignored instead of clearing the selection.
  const justConnectedRef = useRef(false);
  const clickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
  }, []);

  const armClickSuppression = useCallback(() => {
    justConnectedRef.current = true;
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
    clickSuppressionTimerRef.current = setTimeout(() => {
      justConnectedRef.current = false;
      clickSuppressionTimerRef.current = null;
    }, 0);
  }, []);

  /** Abandon the in-flight drag without creating an edge or firing a drop. */
  const cancelDrag = useCallback(() => {
    if (!dragLineRef.current) return;
    const pointerId = activePointerIdRef.current;
    if (capturedRef.current && pointerId !== null) {
      try {
        containerRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Capture may already have been released by pointer cancellation.
      }
    }
    capturedRef.current = false;
    activePointerIdRef.current = null;
    dragLineRef.current = null;
    setDragLine(null);
  }, [containerRef]);

  const checkValid = validateConnection ?? ALLOW_ALL;

  const onConnectStart = useCallback(
    (
      sourceId: string,
      sourceX: number,
      sourceY: number,
      portId: string | undefined,
      pointerId: number
    ) => {
      // Another pointer cannot replace an in-flight connection. This matters
      // for pen + touch, where both contacts can legitimately be `isPrimary`.
      if (dragLineRef.current) return;
      onDragStart?.();
      capturedRef.current = false;
      activePointerIdRef.current = pointerId;
      const initial: DragLineState = {
        sourceId,
        sourcePort: portId,
        source: { x: sourceX, y: sourceY },
        target: { x: sourceX, y: sourceY },
        snapId: null,
        isValid: true,
      };
      dragLineRef.current = initial;
      setDragLine(initial);
    },
    [onDragStart]
  );

  const onContainerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const current = dragLineRef.current;
      if (!current || e.pointerId !== activePointerIdRef.current) return;
      // Recovery: if no button is held we missed the pointerup (the drag left
      // the container before capture was taken, or the release was swallowed).
      // Drop the stale drag rather than letting it resume on a bare hover and
      // create an edge on the next click.
      if (e.buttons === 0) {
        cancelDrag();
        return;
      }
      // Capture on the first move so the drag line keeps tracking (and
      // pointerup still fires here) when the pointer leaves the container.
      // Deferring capture past pointerdown keeps a plain click on the handle
      // targeting the handle, not the container.
      if (!capturedRef.current) {
        capturedRef.current = true;
        containerRef.current?.setPointerCapture(e.pointerId);
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const gy = (e.clientY - rect.top - viewport.y) / viewport.zoom;

      // While the pointer is over another linked graph, stop snapping locally
      // and let the line follow the cursor toward that graph's direction.
      if (crossGraphDrag && resolveForeignRegistration(e.clientX, e.clientY, link, graphId, containerRef.current)) {
        const next: DragLineState = { ...current, target: { x: gx, y: gy }, snapId: null, snapPort: undefined, isValid: true };
        dragLineRef.current = next;
        setDragLine(next);
        return;
      }

      // Ports first: a port is a more specific target than the node that owns
      // it, and only a port hit can produce a `targetPort`. Rejected ports are
      // filtered out during the search so a nearby valid port still wins.
      const portSnapRadius = PORT_SNAP_RADIUS_PX / viewport.zoom;
      const portHit = spatialIndex.current.nearestPort(
        gx,
        gy,
        portSnapRadius,
        current.sourceId,
        (hit) =>
          checkValid({
            source: current.sourceId,
            sourcePort: current.sourcePort,
            target: hit.nodeId,
            targetPort: hit.portId,
          })
      );

      // Every port in range was rejected, but the pointer is still aiming at
      // one. Falling through to the owning node here would drop `targetPort`
      // and quietly downgrade a rejected connection into an unvalidated
      // perimeter one — which no longer counts against `maxConnections`, and,
      // being portless itself, is never counted afterwards either. Hold the
      // snap on the rejected port and show it as invalid instead.
      // The node snap radius strictly contains the port one, so without this
      // the downgrade is the *default* outcome, not an edge case.
      const rejectedPortHit = portHit
        ? null
        : spatialIndex.current.nearestPort(gx, gy, portSnapRadius, current.sourceId);

      let snapId: string | null;
      let snapPort: string | undefined;
      let isValid: boolean;

      if (portHit) {
        snapId = portHit.nodeId;
        snapPort = portHit.portId;
        isValid = true;
      } else if (rejectedPortHit) {
        snapId = rejectedPortHit.nodeId;
        // Output ports are not incoming endpoints, but an output-only node is
        // intentionally connectable at its perimeter. Re-check that exact
        // owning node without a target port instead of letting the output dot
        // shadow the valid perimeter (or relying on a centre-distance snap,
        // which misses wide nodes). Genuine input-port rejections stay red.
        const canUsePerimeter =
          rejectedPortHit.port.mode === "output" &&
          checkValid({
            source: current.sourceId,
            sourcePort: current.sourcePort,
            target: rejectedPortHit.nodeId,
            targetPort: undefined,
          });
        snapPort = canUsePerimeter ? undefined : rejectedPortHit.portId;
        isValid = canUsePerimeter;
      } else {
        // No port in range: fall back to the node, which still needs
        // validating — it just has no target port.
        snapId = spatialIndex.current.nearest(
          gx,
          gy,
          NODE_SNAP_RADIUS_PX / viewport.zoom,
          current.sourceId
        );
        snapPort = undefined;
        isValid = snapId
          ? checkValid({
            source: current.sourceId,
            sourcePort: current.sourcePort,
            target: snapId,
            targetPort: undefined,
          })
          : true;
      }

      const snapPos = snapId ? positions[snapId] : null;
      const snapNode = snapId ? nodeById.get(snapId) : undefined;
      const next: DragLineState = {
        ...current,
        target:
          snapPos && snapNode
            ? resolveNodeAnchor(
              snapNode,
              snapPos,
              current.source,
              resolvedGetNodeRadius,
              getNodeAnchor,
              snapPort,
              portResolver
            )
            : { x: gx, y: gy },
        snapId: snapId ?? null,
        snapPort,
        isValid,
      };
      dragLineRef.current = next;
      setDragLine(next);
    },
    [
      containerRef,
      viewport,
      positions,
      nodeById,
      resolvedGetNodeRadius,
      getNodeAnchor,
      spatialIndex,
      crossGraphDrag,
      link,
      graphId,
      cancelDrag,
      checkValid,
      portResolver,
    ]
  );

  const onContainerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const current = dragLineRef.current;
    if (!current || e.pointerId !== activePointerIdRef.current) return;
    // A captured drag makes the browser retarget the following click to this
    // container; flag it so the container's click handler ignores that click.
    if (capturedRef.current) {
      armClickSuppression();
    }
    capturedRef.current = false;
    activePointerIdRef.current = null;

    // Cross-graph drop: if released over another linked graph, hand the node
    // off to that graph's onExternalDrop with the point mapped into its space.
    if (crossGraphDrag && link && graphId) {
      const reg = resolveForeignRegistration(e.clientX, e.clientY, link, graphId, containerRef.current);
      // Read the handler at drop time — presence can change after registration.
      const handler = reg ? resolveExternalDropHandler(reg) : undefined;
      if (reg && handler) {
        const rect = reg.getContainer()?.getBoundingClientRect();
        if (rect) {
          const vp = reg.getViewport();
          const gx = (e.clientX - rect.left - vp.x) / vp.zoom;
          const gy = (e.clientY - rect.top - vp.y) / vp.zoom;
          handler(
            {
              sourceGraphId: graphId,
              nodeId: current.sourceId,
              key: toKey ? toKey(current.sourceId) : current.sourceId,
            },
            gx,
            gy
          );
          dragLineRef.current = null;
          setDragLine(null);
          return;
        }
      }
    }

    // Re-check on commit rather than trusting the flag from the last move:
    // nodes or edges may have changed underneath a slow drag.
    if (current.snapId && onConnect) {
      const connection: Connection = {
        source: current.sourceId,
        sourcePort: current.sourcePort,
        target: current.snapId,
        targetPort: current.snapPort,
      };
      if (checkValid(connection)) onConnect(connection);
    }
    dragLineRef.current = null;
    setDragLine(null);
  }, [onConnect, checkValid, crossGraphDrag, link, graphId, toKey, containerRef, armClickSuppression]);

  const onContainerPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      cancelDrag();
    },
    [cancelDrag]
  );

  return {
    dragLine,
    onConnectStart,
    onContainerPointerMove,
    onContainerPointerUp,
    onContainerPointerCancel,
    /** Imperative cancellation for deliberate gesture takeover (pinch). */
    cancelDrag,
    justConnectedRef,
  };
}
