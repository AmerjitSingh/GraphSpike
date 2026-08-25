"use client";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Tracks the pixel dimensions of a container element via ResizeObserver.
 * Returns `null` until the first measurement is available.
 */
export function useViewportSize(containerRef: RefObject<HTMLDivElement | null>) {
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef]);

  return viewportSize;
}
