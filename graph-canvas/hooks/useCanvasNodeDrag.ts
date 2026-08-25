"use client";
import { useCallback, useEffect, useRef } from "react";
import { zoomTransform } from "d3-zoom";
import type { GraphCanvasStore } from "../store.js";
import type { NodePosition, Viewport } from "../types.js";
import type { SpatialIndex } from "../spatialIndex.js";
import { snapValueToGrid } from "../ports.js";
import { isChromeEvent } from "../interaction.js";

/** Movement in screen pixels before a press becomes a drag. Matches
 *  `NodeLayer`, so a node feels identical either side of the promotion. */
const DRAG_START_THRESHOLD = 3;


interface UseCanvasNodeDragProps<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  store: GraphCanvasStore;
  spatialIndex: React.RefObject<SpatialIndex<T>>;
  viewport: Viewport;
  /** Ref that is true while space is held (the canvas is in pan mode). */
  spacePressedRef: React.RefObject<boolean>;
  enabled: boolean;
  /** Quantise dragged positions to this grid, matching the HTML layer. */
  snapToGrid?: number;
  onNodeMove?: (id: string, x: number, y: number) => void;
}

interface DragState {
  id: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  /** Where the dragged node started, so a snap resolves against the position
   *  rather than accumulating rounding on every move. */
  nodeX: number;
  nodeY: number;
  /** Live D3 scale at pointerdown. The React viewport can trail D3 by one RAF
   * while a wheel/pan transform is being flushed to the store. */
  zoom: number;
  moved: boolean;
  /** Pre-drag positions of every node this drag will move, keyed by id.
   *  Doubles as the group-drag roster and as the undo record for a cancel. */
  initial: Record<string, NodePosition>;
}

/**
 * Dragging for nodes that live on the canvas rather than in the DOM.
 *
 * Unselected nodes are painted into `NodeCanvasLayer`, which is
 * `pointerEvents: none`, and d3-zoom's filter rejects plain left-drags — so
 * without this a press on a canvas node does nothing at all (or starts a
 * marquee straight through it). Selection promotes a node into `NodeLayer`,
 * which is why dragging appeared to work only for already-selected nodes.
 *
 * This hit-tests the spatial index on pointerdown and drives the store
 * directly, reproducing `NodeLayer`'s semantics: a movement threshold, a
 * transient phase so `onPositionsChange` fires once, group dragging when the
 * pressed node is part of a multi-selection, grid snapping, and `onNodeMove`
 * per moved node on release. Pressing does *not* change the selection — the
 * existing click path still owns that.
 */
export function useCanvasNodeDrag<T>({
  containerRef,
  store,
  spatialIndex,
  viewport,
  spacePressedRef,
  enabled,
  snapToGrid,
  onNodeMove,
}: UseCanvasNodeDragProps<T>) {
  const dragRef = useRef<DragState | null>(null);

  // Set when a drag actually moved something, so the click the browser fires
  // afterwards doesn't re-select (or clear) as if it were a plain click.
  const justDraggedRef = useRef(false);
  const clickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
  }, []);

  const armClickSuppression = useCallback(() => {
    justDraggedRef.current = true;
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
    clickSuppressionTimerRef.current = setTimeout(() => {
      justDraggedRef.current = false;
      clickSuppressionTimerRef.current = null;
    }, 0);
  }, []);

  /** Returns true when the press landed on a node and this hook has claimed
   *  it — the caller must then not start a marquee. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): boolean => {
      if (!enabled || spacePressedRef.current) return false;
      if (e.pointerType === "touch" && !e.isPrimary) return false;
      // `isPrimary` is scoped per pointer type. A primary touch must not
      // replace an in-flight primary pen/mouse drag and orphan its transient.
      if (dragRef.current) return false;
      // Left button only, and never over the graph's own overlay controls.
      if (e.button !== 0 || isChromeEvent(e)) return false;
      // A press on a promoted (selected) node is NodeLayer's to handle.
      if ((e.target as HTMLElement).closest?.("[data-gc-node]")) return false;

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      if (!container || !rect) return false;
      // D3 mutates `__zoom` synchronously, while the public viewport is
      // intentionally RAF-batched. Use the same live transform as the shared
      // arbitration hit-test so it cannot claim a node that this hook then
      // misses against a stale viewport.
      const live = "__zoom" in container ? zoomTransform(container) : null;
      const liveViewport = {
        x: live?.x ?? viewport.x,
        y: live?.y ?? viewport.y,
        zoom: live?.k ?? viewport.zoom,
      };
      const gx = (e.clientX - rect.left - liveViewport.x) / liveViewport.zoom;
      const gy = (e.clientY - rect.top - liveViewport.y) / liveViewport.zoom;

      // Containment only (tolerance 0) — a drag must start *on* the node.
      // Clicking keeps a forgiving radius, but proximity must not claim the
      // press here: the tolerance is in graph units, so zoomed out it grows to
      // hundreds of units and would swallow every marquee gesture on a dense
      // graph. Press precisely to drag; click loosely to select.
      const id = spatialIndex.current.pickAt(gx, gy, 0);
      if (!id) return false;

      const state = store.getState();
      const start = state.positions[id];
      if (!start) return false;

      // Group drag only when the pressed node is itself part of a
      // multi-selection, matching NodeLayer.
      const selected = state.selectedNodeIds;
      const initial = Object.create(null) as Record<string, NodePosition>;
      initial[id] = { ...start };
      if (selected.length > 1 && selected.includes(id)) {
        for (const peerId of selected) {
          const p = state.positions[peerId];
          if (peerId !== id && p) initial[peerId] = { ...p };
        }
      }

      dragRef.current = {
        id,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        nodeX: start.x,
        nodeY: start.y,
        zoom: liveViewport.zoom,
        moved: false,
        initial,
      };
      return true;
    },
    [enabled, spacePressedRef, containerRef, viewport, spatialIndex, store]
  );

  /** Finish a drag: report every node that moved and close the transient.
   *  `expectClick` is false for the missed-pointerup recovery — no click
   *  follows a release the browser never delivered, so arming the suppression
   *  flag there would swallow the user's next, unrelated click. */
  const commitDrag = useCallback(
    (drag: DragState, expectClick: boolean) => {
      dragRef.current = null;
      // A press that never moved is a click; leave it entirely to the
      // container's click handler so selection behaviour is unchanged.
      if (!drag.moved) return;

      if (expectClick) {
        armClickSuppression();
      }
      const positions = store.getState().positions;
      for (const id of Object.keys(drag.initial)) {
        // A node deleted mid-drag has no position; reporting a move for it
        // would hand the consumer an id it has already removed.
        const p = positions[id];
        if (p) onNodeMove?.(id, p.x, p.y);
      }
      store.getState().endTransient();
    },
    [store, onNodeMove, armClickSuppression]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      // Recovery: no button held means we missed the pointerup (the release
      // was swallowed, or the pointer left the window before capture). The
      // node has already moved, so finish the drag properly rather than just
      // dropping it — silently ending the transient would leave the consumer
      // with a moved node it was never told about.
      if (e.buttons === 0) {
        commitDrag(drag, false);
        return;
      }

      // The node may have been deleted mid-drag. Writing a position for it
      // would resurrect it in the store.
      if (!store.getState().positions[drag.id]) {
        dragRef.current = null;
        if (drag.moved) store.getState().endTransient();
        return;
      }

      const screenDx = e.clientX - drag.clientX;
      const screenDy = e.clientY - drag.clientY;

      if (!drag.moved) {
        if (Math.hypot(screenDx, screenDy) < DRAG_START_THRESHOLD) return;
        drag.moved = true;
        // Capture only once the press is definitely a drag, so a plain click
        // still reaches the container's click handler untouched.
        containerRef.current?.setPointerCapture(e.pointerId);
        // Suppress onPositionsChange until the drag ends.
        store.getState().beginTransient();
      }

      const dx = screenDx / drag.zoom;
      const dy = screenDy / drag.zoom;
      // Snap the resolved position rather than the delta, so a node that began
      // off-grid lands on the grid instead of staying permanently offset.
      const x = snapValueToGrid(drag.nodeX + dx, snapToGrid);
      const y = snapValueToGrid(drag.nodeY + dy, snapToGrid);

      const live = store.getState().positions;
      const updates = [{ id: drag.id, x, y }];
      for (const [peerId, p] of Object.entries(drag.initial)) {
        if (peerId === drag.id) continue;
        // Skip peers deleted mid-drag, for the same reason.
        if (!live[peerId]) continue;
        updates.push({ id: peerId, x: p.x + (x - drag.nodeX), y: p.y + (y - drag.nodeY) });
      }
      store.getState().setNodePositions(updates);
    },
    [containerRef, store, snapToGrid, commitDrag]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      commitDrag(drag, true);
    },
    [commitDrag]
  );

  /** A cancelled pointer is an abandoned drag, not a completed one: put every
   *  node back where it started and fire no move callbacks. */
  const onPointerCancel = useCallback((event?: { pointerId: number }) => {
    const drag = dragRef.current;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    dragRef.current = null;
    try {
      containerRef.current?.releasePointerCapture(drag.pointerId);
    } catch {
      // The UA may already have released capture while promoting to pinch.
    }
    if (!drag.moved) return;

    // Restore only nodes that still exist — recreating a position for one
    // deleted mid-drag would resurrect it.
    const live = store.getState().positions;
    const restore = Object.entries(drag.initial)
      .filter(([id]) => live[id])
      .map(([id, p]) => ({ id, x: p.x, y: p.y }));
    if (restore.length > 0) store.getState().setNodePositions(restore);
    store.getState().endTransient();
  }, [containerRef, store]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, justDraggedRef };
}
