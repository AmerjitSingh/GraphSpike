"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { GraphNode, Viewport } from "../types.js";
import type { GraphCanvasStore } from "../store.js";
import type { SpatialIndex } from "../spatialIndex.js";

// Minimum drag distance (px) before a marquee is committed.
const MIN_DRAG_PX = 4;

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseMarqueeSelectProps<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  nodes: GraphNode<T>[];
  spatialIndex: React.RefObject<SpatialIndex<T>>;
  spacePressedRef: React.RefObject<boolean>;
  store: GraphCanvasStore;
  enabled?: boolean;
}

export function useMarqueeSelect<T>({
  containerRef,
  viewport,
  nodes,
  spatialIndex,
  spacePressedRef,
  store,
  enabled = false,
}: UseMarqueeSelectProps<T>) {
  // State that persists across pointer events for a single drag session.
  const dragRef = useRef<{
    startX: number;
    startY: number;
    pointerId: number;
    shift: boolean;
    captured: boolean;
  } | null>(null);

  // Set to true after a successful marquee selection so the subsequent
  // browser-fired `click` event can be suppressed (prevents the click handler
  // from immediately clearing the selection we just set).
  const justMarqueedRef = useRef(false);
  const clickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
  }, []);

  const armClickSuppression = useCallback(() => {
    justMarqueedRef.current = true;
    if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
    clickSuppressionTimerRef.current = setTimeout(() => {
      justMarqueedRef.current = false;
      clickSuppressionTimerRef.current = null;
    }, 0);
  }, []);

  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  // Refs so event callbacks always see the latest values without being
  // recreated on every render (which would happen with nodes/positions/viewport
  // as useCallback deps because the force layout updates them every frame).
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      if (e.pointerType === "touch" && !e.isPrimary) return;
      // Primary is per pointer type; do not let a touch replace an active pen
      // marquee (or vice versa) and strand its capture/state.
      if (dragRef.current) return;
      if (spacePressedRef.current) return;
      // Only start on blank canvas — not on nodes, handles, or context menus.
      if (
        (e.target as HTMLElement).closest(
          "[data-gc-node], [data-gc-handle], [data-gc-context-menu], [data-gc-minimap], [data-gc-chrome]"
        )
      ) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      dragRef.current = {
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        pointerId: e.pointerId,
        shift: e.shiftKey,
        captured: false,
      };
    },
    [containerRef, enabled, spacePressedRef]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      // Recovery: no button held means we missed the pointerup (drag left the
      // container before the capture threshold, or the release was swallowed).
      // Drop the stale drag so it can't paint a marquee that follows a bare
      // hover and commit a selection on the next click.
      if (e.buttons === 0) {
        dragRef.current = null;
        justMarqueedRef.current = false;
        setMarqueeRect(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { startX, startY } = dragRef.current;

      // Once this is a real marquee (not click jitter), capture the pointer so
      // tracking and pointerup survive the drag crossing the container edge.
      // Capturing only past the threshold keeps plain clicks targeting the
      // element under the pointer (a captured pointer's click retargets here).
      if (
        !dragRef.current.captured &&
        (Math.abs(cx - startX) >= MIN_DRAG_PX || Math.abs(cy - startY) >= MIN_DRAG_PX)
      ) {
        dragRef.current.captured = true;
        containerRef.current?.setPointerCapture(e.pointerId);
      }

      setMarqueeRect({
        x: Math.min(startX, cx),
        y: Math.min(startY, cy),
        width: Math.abs(cx - startX),
        height: Math.abs(cy - startY),
      });
    },
    [containerRef]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setMarqueeRect(null);

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Treat tiny drags as plain clicks, not marquee selections.
      if (
        Math.abs(cx - drag.startX) < MIN_DRAG_PX &&
        Math.abs(cy - drag.startY) < MIN_DRAG_PX
      ) return;

      const minX = Math.min(drag.startX, cx);
      const maxX = Math.max(drag.startX, cx);
      const minY = Math.min(drag.startY, cy);
      const maxY = Math.max(drag.startY, cy);

      const vp = viewportRef.current;
      const graphBounds = {
        minX: (minX - vp.x) / vp.zoom,
        minY: (minY - vp.y) / vp.zoom,
        maxX: (maxX - vp.x) / vp.zoom,
        maxY: (maxY - vp.y) / vp.zoom,
      };
      const hits = spatialIndex.current.search(graphBounds);
      const hitIds = new Set(hits.map((item) => item.id));
      const captured = nodesRef.current
        .map((node) => node.id)
        .filter((id) => hitIds.has(id));

      const state = store.getState();
      if (drag.shift) {
        // Add to existing selection.
        store.getState().setSelection([...new Set([...state.selectedNodeIds, ...captured])]);
      } else {
        store.getState().setSelection(captured);
      }

      // Suppress the click event the browser fires after pointerup, but only
      // when we captured nodes — an empty marquee drag should not eat the
      // subsequent click (which the user may intend as a deselect).
      if (captured.length > 0) {
        armClickSuppression();
      }
    },
    [containerRef, spatialIndex, store, armClickSuppression]
  );

  const onPointerCancel = useCallback((event?: { pointerId: number }) => {
    const drag = dragRef.current;
    if (event && (!drag || event.pointerId !== drag.pointerId)) return;
    if (drag?.captured) {
      try {
        containerRef.current?.releasePointerCapture(drag.pointerId);
      } catch {
        // Capture may already be gone when the browser promotes to pinch.
      }
    }
    dragRef.current = null;
    justMarqueedRef.current = false;
    setMarqueeRect(null);
  }, [containerRef]);

  return { marqueeRect, justMarqueedRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
