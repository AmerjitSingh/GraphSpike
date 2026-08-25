import { describe, it, expect } from "vitest";
import { computeMiniMapGeometry } from "../renderers/MiniMap";
import type { GraphRect } from "../geometry";

const PANEL = { w: 190, h: 130 };
const CONTAINER = { w: 800, h: 500 };

/** Where the viewport rectangle lands inside the minimap panel. */
function viewRect(
  bounds: GraphRect | null,
  viewport: { x: number; y: number; zoom: number }
) {
  const g = computeMiniMapGeometry(
    bounds, viewport, CONTAINER.w, CONTAINER.h, PANEL.w, PANEL.h
  );
  if (!g) return null;
  const visMinX = -viewport.x / viewport.zoom;
  const visMinY = -viewport.y / viewport.zoom;
  return {
    x: (visMinX - g.boundsMinX) * g.scale + g.offsetX,
    y: (visMinY - g.boundsMinY) * g.scale + g.offsetY,
    w: (CONTAINER.w / viewport.zoom) * g.scale,
    h: (CONTAINER.h / viewport.zoom) * g.scale,
    scale: g.scale,
  };
}

describe("computeMiniMapGeometry", () => {
  const spread: GraphRect = { minX: -500, minY: -400, maxX: 500, maxY: 400 };

  it("returns null when there is nothing to fit", () => {
    expect(computeMiniMapGeometry(null, { x: 0, y: 0, zoom: 1 }, 800, 500, 190, 130)).toBeNull();
  });

  it("returns null for a degenerate zoom instead of dividing by zero", () => {
    expect(computeMiniMapGeometry(spread, { x: 0, y: 0, zoom: 0 }, 800, 500, 190, 130)).toBeNull();
    const nan = computeMiniMapGeometry(spread, { x: 0, y: 0, zoom: NaN }, 800, 500, 190, 130);
    expect(nan).toBeNull();
  });

  it("never magnifies a tiny cluster past life size", () => {
    // Three nodes within 20 graph units used to produce scale ~1.87.
    const tight: GraphRect = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const g = computeMiniMapGeometry(tight, { x: 0, y: 0, zoom: 1 }, 800, 500, 190, 130)!;
    expect(g.scale).toBeLessThanOrEqual(1);
  });

  it("keeps the viewport indicator inside the panel when panned far away", () => {
    // Pan ~5000 graph units right of the node cloud: the indicator used to be
    // clipped out of existence because bounds ignored the viewport.
    const r = viewRect(spread, { x: -5000, y: 0, zoom: 1 })!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(PANEL.w + 0.001);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(PANEL.h + 0.001);
  });

  it("keeps the indicator inside the panel for a tiny graph at zoom 1", () => {
    // Previously the rect computed 1496x935 inside a 190x130 panel.
    const tight: GraphRect = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const r = viewRect(tight, { x: 0, y: 0, zoom: 1 })!;
    expect(r.w).toBeLessThanOrEqual(PANEL.w);
    expect(r.h).toBeLessThanOrEqual(PANEL.h);
  });

  it("keeps the whole graph inside the panel when fitted", () => {
    const g = computeMiniMapGeometry(spread, { x: 0, y: 0, zoom: 1 }, 800, 500, 190, 130)!;
    const corners = [
      [spread.minX, spread.minY],
      [spread.maxX, spread.maxY],
    ] as const;
    for (const [gx, gy] of corners) {
      const x = (gx - g.boundsMinX) * g.scale + g.offsetX;
      const y = (gy - g.boundsMinY) * g.scale + g.offsetY;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(PANEL.w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(PANEL.h);
    }
  });

  it("drifts the pointer->graph mapping as the viewport moves (why navigation must freeze it)", () => {
    // The drawn geometry intentionally follows the viewport so the indicator
    // stays in frame. That means the SAME minimap pixel maps to DIFFERENT graph
    // points as the view moves — which is exactly why MiniMap snapshots the
    // geometry at pointerdown and reuses it for the whole gesture. Without the
    // freeze, each navigation shifts the next event's target and the viewport
    // accelerates away from the cursor.
    const pixel = 60;
    const at = (viewport: { x: number; y: number; zoom: number }) => {
      const g = computeMiniMapGeometry(spread, viewport, CONTAINER.w, CONTAINER.h, PANEL.w, PANEL.h)!;
      return (pixel - g.offsetX) / g.scale + g.boundsMinX;
    };
    const before = at({ x: 0, y: 0, zoom: 1 });
    const afterNavigating = at({ x: -1200, y: 0, zoom: 1 });
    expect(afterNavigating).not.toBeCloseTo(before);
  });

  it("survives a zero-sized panel without producing NaN", () => {
    const g = computeMiniMapGeometry(spread, { x: 0, y: 0, zoom: 1 }, 800, 500, 0, 0)!;
    expect(Number.isFinite(g.scale)).toBe(true);
    expect(Number.isFinite(g.offsetX)).toBe(true);
    expect(Number.isFinite(g.offsetY)).toBe(true);
  });
});
