import { useRef, useLayoutEffect, useCallback, useState } from "react";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import { zoom as d3Zoom, zoomIdentity, zoomTransform } from "d3-zoom";
import type { ZoomBehavior } from "d3-zoom";
// Side-effect import: augments Selection with `.transition()`, which panTo
// and zoomBy use for animated moves.
// oxlint-disable-next-line import/no-unassigned-import
import "d3-transition";
import { useRawGraphCanvasStore } from "../store.js";
import {
  isChromeTarget,
  isInteractiveTarget,
  isPrimaryGestureControlTarget,
  resolvePrimaryGestureOwner,
} from "../interaction.js";
import type { NodePosition } from "../types.js";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 4;
const FIT_PADDING = 60;

/** Minimal shape of the events d3-zoom hands to its filter. */
export interface ZoomFilterEvent {
  type: string;
  button?: number;
  /** Present on touch events. d3 drives pinch zoom from multi-touch itself. */
  touches?: ArrayLike<{
    clientX: number;
    clientY: number;
    /** Element where this individual contact began. A multi-touch event's own
     * target describes only the contact that dispatched that event. */
    target?: EventTarget | null;
  }>;
  changedTouches?: ArrayLike<{
    clientX: number;
    clientY: number;
    target?: EventTarget | null;
  }>;
  target: { closest?: (selector: string) => unknown } | null;
  clientX?: number;
  clientY?: number;
}

/** Client point associated with a d3 source event. TouchEvent keeps its
 * coordinates on the touches rather than on the event object itself. */
export function getZoomEventClientPoint(event: ZoomFilterEvent): { x: number; y: number } {
  const touch = event.touches?.[0] ?? event.changedTouches?.[0];
  return {
    x: touch?.clientX ?? event.clientX ?? 0,
    y: touch?.clientY ?? event.clientY ?? 0,
  };
}

function isMultiTouch(event: ZoomFilterEvent): boolean {
  return (event.touches?.length ?? 0) > 1;
}

/** Multi-touch events can combine contacts that began on different elements.
 * D3 consumes every entry in `touches`, not only the contact represented by
 * `event.target`, so one control-owned contact must veto the whole pinch. */
function hasOwnedTouchTarget(event: ZoomFilterEvent): boolean {
  const touches = event.touches;
  if (!touches) return false;
  for (let index = 0; index < touches.length; index += 1) {
    const target = touches[index]?.target ?? null;
    if (isPrimaryGestureControlTarget(target)) return true;
  }
  return false;
}

/**
 * Decides whether a d3-zoom pan/zoom gesture may start. Extracted so the rules
 * are unit-testable — several of them exist to stop a gesture double-applying
 * with an overlay's own interaction.
 */
export function shouldZoomGestureStart(
  event: ZoomFilterEvent,
  { spacePressed, panOnDrag, marqueeSelect = false, isPointOnNode }:
    {
      spacePressed: boolean;
      panOnDrag: boolean;
      marqueeSelect?: boolean;
      /** Hit-test in client coordinates, so canvas-only nodes are visible to
       *  this filter the same way DOM nodes are. */
      isPointOnNode?: (clientX: number, clientY: number) => boolean;
    }
): boolean {
  const target = event.target;
  // Canvas chrome (minimap, context menu, fit button) drives its own
  // interactions — never let a gesture starting there also pan/zoom the view.
  if (isChromeTarget(target as EventTarget | null) || hasOwnedTouchTarget(event)) return false;
  // Wheel zooms the canvas — unless it started over a control the consumer
  // rendered, where it belongs to that control (a scrollable list, a select,
  // a number input).
  if (event.type === "wheel") return !isInteractiveTarget(target as EventTarget | null);
  // Controls keep multi-touch as well as single-touch. A pinch beginning on a
  // slider or editable surface must not zoom the graph behind it.
  if (isInteractiveTarget(target as EventTarget | null)) return false;
  // A multi-touch gesture is a pinch: d3 owns it, and neither node dragging
  // nor the marquee has any use for a second contact. Checked before anything
  // else so pinch zoom can never be filtered out by the single-press rules.
  if (isMultiTouch(event)) return true;

  // Touch has no `button`, so every button test below would silently miss and
  // let a touch drag through paths meant for the primary mouse button — which
  // is how a single touch could start a pan and a marquee at once.
  const isPrimaryPress = event.type.startsWith("touch") || event.button === 0;

  // A press is "on a node" if the spatial index says so — canvas nodes have no
  // DOM to match, so a selector alone would treat them as blank space and give
  // the same drag a different owner before and after selection promoted the
  // node into the DOM layer.
  const point = getZoomEventClientPoint(event);
  const pointOnNode = isPointOnNode?.(point.x, point.y) ?? false;

  // Right-drag must not pan: it opens the context menu, and a couple of pixels
  // of drift would otherwise move the viewport and dismiss that menu.
  if (event.button === 2) return false;
  // Middle-mouse drag.
  if (event.button === 1) return true;
  if (isPrimaryPress) {
    return resolvePrimaryGestureOwner({
      target: target as EventTarget | null,
      pointOnNode,
      spacePressed,
      panOnDrag,
      marqueeSelect,
    }) === "pan";
  }
  // Block drag starting inside a node element.
  if (target?.closest?.("[data-gc-node]")) return false;
  return true;
}

interface UseCanvasZoomParams {
  /** True when marquee selection is on. It also claims left-drag on blank
   *  canvas, and it is the gesture that has no fallback, so it wins. */
  marqueeSelect?: boolean;
  /** Hit-test in client coordinates. Canvas-drawn nodes have no DOM, so
   *  without this the filter cannot tell them from blank canvas. */
  isPointOnNode?: (clientX: number, clientY: number) => boolean;
  /** Cancel any single-contact interaction just before d3 accepts a pinch. */
  onPinchStart?: () => void;
  /** Owned by the caller so other hooks (space-bar pan) can scope their
   *  listeners to the same element without a circular hook order. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref that is true while the space key is held (enables pan mode). */
  spacePressedRef: React.RefObject<boolean>;
  /** Allow left-click drag to pan (for chart-like views). */
  panOnDrag?: boolean;
}

export interface UseCanvasZoomReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  layoutReady: boolean;
  /** Fit all nodes into view with animation. */
  fitToView: (
    positions: Record<string, NodePosition>,
    getRadius: (id: string) => number
  ) => void;
  /** Pan and zoom to a specific coordinate. Pass animate=false for an instant
   *  jump (no transition), e.g. live minimap dragging. */
  panTo: (x: number, y: number, targetZoom?: number, animate?: boolean) => void;
  /** Scale the viewport about its centre by `factor` (>1 zooms in). */
  zoomBy: (factor: number, animate?: boolean) => void;
  /** True once the user has panned/zoomed by hand (not programmatically), so
   *  callers can stop stealing the viewport with deferred auto-fits. */
  userInteractedRef: React.RefObject<boolean>;
}

export function useCanvasZoom({
  containerRef,
  spacePressedRef,
  panOnDrag = false,
  marqueeSelect = false,
  isPointOnNode,
  onPinchStart,
}: UseCanvasZoomParams): UseCanvasZoomReturn {
  const store = useRawGraphCanvasStore();


  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const selectionRef = useRef<Selection<HTMLDivElement, unknown, null, undefined> | null>(null);

  // RAF-based dedup: only flush the last viewport update per animation frame.
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);

  const [layoutReady, setLayoutReady] = useState(false);

  // True once the initial centring has been applied, so re-creating the zoom
  // behavior (e.g. when panOnDrag changes) doesn't reset the viewport.
  const didInitRef = useRef(false);
  // True once a real user gesture has moved the viewport.
  const userInteractedRef = useRef(false);

  // Read through a ref so a changing hit-test doesn't tear down d3's handlers.
  const isPointOnNodeRef = useRef(isPointOnNode);
  isPointOnNodeRef.current = isPointOnNode;
  const onPinchStartRef = useRef(onPinchStart);
  onPinchStartRef.current = onPinchStart;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const container = select(el);

    const zoom = d3Zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event) => {
        const allowed = shouldZoomGestureStart(event, {
          spacePressed: spacePressedRef.current,
          panOnDrag,
          marqueeSelect,
          isPointOnNode: isPointOnNodeRef.current,
        });
        // The filter runs synchronously inside d3's touchstart handler. Cancel
        // the first contact's owner before d3 records both touches and begins
        // emitting zoom events.
        if (allowed && isMultiTouch(event)) onPinchStartRef.current?.();
        return allowed;
      })
      .on("zoom", (e) => {
        // sourceEvent is null for programmatic zoom.transform calls, so this
        // flags genuine user gestures only (used to cancel a pending auto-fit).
        if (e.sourceEvent) userInteractedRef.current = true;
        pendingViewport.current = { x: e.transform.x, y: e.transform.y, zoom: e.transform.k };
        if (rafRef.current !== null) return;
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          const next = pendingViewport.current;
          if (!next) return;
          pendingViewport.current = null;
          const prev = lastViewport.current;
          if (prev && prev.x === next.x && prev.y === next.y && prev.zoom === next.zoom) return;
          lastViewport.current = next;
          store.getState().setViewport(next);
        });
      });

    zoomRef.current = zoom;
    selectionRef.current = container;
    container.call(zoom);
    // Disable D3's built-in double-click zoom — we handle double-click ourselves.
    container.on("dblclick.zoom", null);

    // d3 keeps the live transform on the element itself (`__zoom`) and a newly
    // attached zoom behavior inherits it, so a re-run of this effect already
    // preserves the viewport — only the very first init needs to centre.
    if (!didInitRef.current) {
      didInitRef.current = true;
      container.call(zoom.transform, zoomIdentity.translate(width / 2, height / 2));
    }

    // Push the live transform to the store synchronously. The zoom handler
    // above only schedules a RAF, and this effect's cleanup cancels it — so
    // under StrictMode the first mount's centring would never reach React,
    // leaving d3 centred while the store still read {0,0,1}.
    const applied = zoomTransform(el);
    const next = { x: applied.x, y: applied.y, zoom: applied.k };
    const prev = lastViewport.current;
    if (!prev || prev.x !== next.x || prev.y !== next.y || prev.zoom !== next.zoom) {
      lastViewport.current = next;
      store.getState().setViewport(next);
    }

    setLayoutReady(true); // eslint-disable-line react-hooks/set-state-in-effect

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      container.on(".zoom", null);
      zoomRef.current = null;
      selectionRef.current = null;
    };
  }, [store, containerRef, spacePressedRef, panOnDrag, marqueeSelect]);

  const fitToView = useCallback(
    (positions: Record<string, NodePosition>, getRadius: (id: string) => number) => {
      const el = containerRef.current;
      const selection = selectionRef.current;
      const zoom = zoomRef.current;
      if (!el || !selection || !zoom) return;

      const ids = Object.keys(positions);
      if (ids.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of ids) {
        const pos = positions[id];
        const r = getRadius(id) + 8;
        minX = Math.min(minX, pos.x - r);
        minY = Math.min(minY, pos.y - r);
        maxX = Math.max(maxX, pos.x + r);
        maxY = Math.max(maxY, pos.y + r);
      }

      if (!Number.isFinite(minX)) return;
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const { width, height } = el.getBoundingClientRect();
      // A hidden container measures 0×0 — the scale would clamp to MIN_ZOOM
      // and leave the graph microscopic. Refuse rather than apply a garbage
      // transform the caller has no way to notice.
      if (width <= 0 || height <= 0) return;
      const scale = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.min(
          (width - FIT_PADDING * 2) / bw,
          (height - FIT_PADDING * 2) / bh
        ))
      );
      const x = (width - bw * scale) / 2 - minX * scale;
      const y = (height - bh * scale) / 2 - minY * scale;

      // zoom.transform fires a zoom event which flushes the viewport to the
      // store via the RAF path in the zoom handler — no need to set it twice.
      selection.call(zoom.transform, zoomIdentity.translate(x, y).scale(scale));
    },
    [containerRef]
  );

  const panTo = useCallback(
    (x: number, y: number, targetZoom: number = 2, animate: boolean = true) => {
      const el = containerRef.current;
      const selection = selectionRef.current;
      const zoom = zoomRef.current;
      if (!el || !selection || !zoom) return;
      // A non-finite target coordinate would poison the transform.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const { width, height } = el.getBoundingClientRect();

      // Clamp to the configured extent. Zero, negative or NaN zoom otherwise
      // reaches d3 unchecked and renders a blank canvas — and every hit-test
      // divides by zoom, so it poisons picking too.
      const safeZoom = Number.isFinite(targetZoom)
        ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom))
        : 1;

      // Calculate transform to put (x,y) at the center of the screen at safeZoom
      const tx = width / 2 - x * safeZoom;
      const ty = height / 2 - y * safeZoom;
      const transform = zoomIdentity.translate(tx, ty).scale(safeZoom);

      // Instant (animate=false) drives d3's transform directly — used by the
      // minimap so dragging pans live and d3's internal state stays in sync.
      if (animate) {
        selection.transition().duration(750).call(zoom.transform, transform);
      } else {
        selection.call(zoom.transform, transform);
      }
    },
    [containerRef]
  );

  /** Scale the viewport about its centre by `factor`. Goes through d3's own
   *  `scaleBy` so the zoom behaviour's internal transform stays authoritative —
   *  writing the store directly would desync the next wheel gesture. */
  const zoomBy = useCallback((factor: number, animate: boolean = true) => {
    const selection = selectionRef.current;
    const zoom = zoomRef.current;
    if (!selection || !zoom || !Number.isFinite(factor) || factor <= 0) return;
    const target = animate ? selection.transition().duration(200) : selection;
    // d3 clamps to the configured scaleExtent for us.
    zoom.scaleBy(target as never, factor);
  }, []);

  return { containerRef, layoutReady, fitToView, panTo, zoomBy, userInteractedRef };
}
