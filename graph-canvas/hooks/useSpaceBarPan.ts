"use client";
import { useEffect, useRef, useState } from "react";
import { isChromeTarget, isInteractiveTarget } from "../interaction.js";

/**
 * Tracks whether the space bar is currently held down.
 * Returns a stable ref that stays `true` while space is pressed,
 * allowing pan mode to be enabled without triggering re-renders.
 *
 * Listening on `window` is deliberate — the graph container has no `tabIndex`,
 * so it never receives key events itself — but the gesture still has to belong
 * to *this* graph. Without the ownership check below, merely mounting a graph
 * (off-screen, in a collapsed panel, in a background tab-panel) would kill
 * space-to-scroll for the entire page and break Space activation on every
 * custom control outside it.
 */
export function useSpaceBarPan(containerRef?: React.RefObject<HTMLElement | null>) {
  const spacePressedRef = useRef(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const hoveredRef = useRef(false);

  useEffect(() => {
    const container = containerRef?.current;

    const release = () => {
      if (!spacePressedRef.current) return;
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };

    const onPointerEnter = () => { hoveredRef.current = true; };
    const onPointerLeave = () => { hoveredRef.current = false; };

    /** Is this graph the one the user is currently addressing? */
    const ownsGesture = () => {
      // No container wired (bare hook usage, tests): keep the old behaviour.
      if (!container) return true;
      if (hoveredRef.current) return true;
      const active = document.activeElement;
      return !!active && container.contains(active);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // A descendant may already have claimed Space in its own key handler.
      // Native controls, editable content and ARIA widgets own it regardless of
      // whether focus came from keyboard or mouse.
      if (e.defaultPrevented || isChromeTarget(e.target) || isInteractiveTarget(e.target)) return;
      // Space belongs to the page unless the pointer is over this graph or
      // focus is inside it.
      if (!ownsGesture()) return;

      e.preventDefault();
      if (!spacePressedRef.current) {
        spacePressedRef.current = true;
        setIsSpacePressed(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") release();
    };

    // Alt-tabbing (or any focus loss) while space is held swallows the keyup,
    // which would otherwise strand the canvas in pan mode with a grab cursor
    // until the user pressed and released space again.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") release();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibilityChange);
    container?.addEventListener("pointerenter", onPointerEnter);
    container?.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      container?.removeEventListener("pointerenter", onPointerEnter);
      container?.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [containerRef]);

  return { spacePressedRef, isSpacePressed };
}
