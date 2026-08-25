"use client";
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Describes a single draggable element managed by {@link useOverlayDrag}.
 *
 * @typeParam S - A snapshot type captured at the start of the drag (e.g. initial
 *   prices, positions, or any state needed to compute the new value during the drag).
 */
export interface OverlayDragHandle<S> {
  /** Ref to the DOM element that should be draggable. */
  ref: RefObject<HTMLElement | null>;
  /**
   * Called on `pointerdown` to capture a snapshot of the current state.
   * The returned value is passed into {@link onDrag} on every subsequent `pointermove`.
   */
  getStartState: () => S;
  /**
   * Called on every `pointermove` while the drag is active.
   *
   * @param startState - The snapshot returned by {@link getStartState}.
   * @param deltaX - Horizontal pixel distance from the initial pointer position.
   * @param deltaY - Vertical pixel distance from the initial pointer position.
   */
  onDrag: (startState: S, deltaX: number, deltaY: number) => void;
}

/**
 * Attaches **native** DOM pointer listeners to one or more overlay elements so
 * that drag interactions are intercepted **before** D3 zoom (which also listens
 * at the native level).
 *
 * Each handle element gets `pointerdown` (with `stopPropagation` +
 * `preventDefault` + `setPointerCapture`), `pointermove`, `pointerup`, and
 * `pointercancel` listeners.  The consumer receives raw pixel deltas and is
 * responsible for converting them to domain-specific units (prices, days, etc.).
 *
 * @example
 * ```tsx
 * const boxRef = useRef<HTMLDivElement>(null);
 *
 * useOverlayDrag([
 *   {
 *     ref: boxRef,
 *     getStartState: () => ({ ...trade }),
 *     onDrag: (st, dx, dy) => {
 *       const deltaPrice = dy / (Y_SCALE * viewport.zoom);
 *       setTrade({ ...st, entry: st.entry - deltaPrice });
 *     },
 *   },
 * ]);
 * ```
 */
export function useOverlayDrag<S>(handles: OverlayDragHandle<S>[]): void {
  // Keep a stable ref to the latest handles array so the effect closure always
  // reads up-to-date callbacks without needing to re-attach DOM listeners.
  const handlesRef = useRef(handles);
  handlesRef.current = handles;

  // Track the active drag so pointermove/up know which handle started it.
  const activeRef = useRef<{
    index: number;
    startState: S;
    startClientX: number;
    startClientY: number;
  } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const cleanups: (() => void)[] = [];

    for (let i = 0; i < handles.length; i++) {
      const el = handles[i]?.ref.current;
      if (!el) continue;

      const idx = i; // capture for closure

      const onDown = (e: PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          if (typeof el.setPointerCapture === "function") {
            el.setPointerCapture(e.pointerId);
          }
        } catch {}
        const handle = handlesRef.current[idx];
        if (!handle) return;
        activeRef.current = {
          index: idx,
          startState: handle.getStartState(),
          startClientX: e.clientX,
          startClientY: e.clientY,
        };
      };

      const onMove = (e: PointerEvent) => {
        const active = activeRef.current;
        if (!active || active.index !== idx) return;
        const handle = handlesRef.current[idx];
        if (!handle) return;
        handle.onDrag(
          active.startState,
          e.clientX - active.startClientX,
          e.clientY - active.startClientY,
        );
      };

      const onUp = (e: PointerEvent) => {
        if (!activeRef.current || activeRef.current.index !== idx) return;
        try {
          if (typeof el.hasPointerCapture === "function" && el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          } else if (typeof el.releasePointerCapture === "function") {
            el.releasePointerCapture(e.pointerId);
          }
        } catch {}
        activeRef.current = null;
      };

      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);

      cleanups.push(() => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      });
    }

    return () => {
      cleanups.forEach((c) => c());
    };
    // Deliberately no dependency array.
    //
    // The obvious version — `handles.map(h => h.ref.current)` — is wrong twice
    // over: it's a variable-length deps array, and it reads `ref.current`
    // during render, which is still null on the render that mounts a handle.
    // A handle added later would then never get its listeners attached.
    //
    // Re-running every render is cheap (a handful of add/removeEventListener
    // calls on elements that are already in the DOM) and always correct.
    // Callbacks are read from `handlesRef` so stale closures aren't a concern.
  });
}
