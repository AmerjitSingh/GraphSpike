import { describe, it, expect } from "vitest";
import {
  getAnchorPoint,
  getEdgeControlPoints,
  getEdgeRouteGeometry,
  buildEdgePath,
  bezierPoint,
  resolveEdgeRouteType,
  resolveEdgeCurveStrength,
  isBezierEdgeRoute,
  getNodeRadius,
  getNodeAnchor,
  getEdgeAnchors,
  resolveEdgeControlPoints,
  getVisibleGraphRect,
  DEFAULT_NODE_RADIUS,
} from "../geometry";
import type { EdgeRouteType, GraphNode, NodePosition } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const origin = { x: 0, y: 0 };
const right = { x: 100, y: 0 };
const left = { x: -100, y: 0 };
const up = { x: 0, y: -100 };
const down = { x: 0, y: 100 };

function node(id: string): GraphNode<unknown> {
  return { id, data: null };
}

// ─── getNodeRadius ────────────────────────────────────────────────────────────

describe("getNodeRadius", () => {
  it("returns DEFAULT_NODE_RADIUS when no callback provided", () => {
    expect(getNodeRadius(node("a"))).toBe(DEFAULT_NODE_RADIUS);
  });

  it("returns the value from the callback when provided", () => {
    expect(getNodeRadius(node("a"), () => 56)).toBe(56);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "falls back for an invalid custom radius (%s)",
    (radius) => {
      expect(getNodeRadius(node("a"), () => radius)).toBe(DEFAULT_NODE_RADIUS);
    }
  );

  it("preserves a zero radius", () => {
    expect(getNodeRadius(node("a"), () => 0)).toBe(0);
  });
});

// ─── getAnchorPoint ───────────────────────────────────────────────────────────

describe("getAnchorPoint", () => {
  it("returns a point exactly `radius` away from `from`", () => {
    const radius = 40;
    const anchor = getAnchorPoint(origin, right, radius);
    const dist = Math.hypot(anchor.x - origin.x, anchor.y - origin.y);
    expect(dist).toBeCloseTo(radius);
  });

  it("points rightward when target is directly to the right", () => {
    const anchor = getAnchorPoint(origin, right, 40);
    expect(anchor).toEqual({ x: 40, y: 0 });
  });

  it("points leftward when target is directly to the left", () => {
    const anchor = getAnchorPoint(origin, left, 40);
    expect(anchor).toEqual({ x: -40, y: 0 });
  });

  it("points upward when target is directly above", () => {
    const anchor = getAnchorPoint(origin, up, 40);
    expect(anchor.x).toBeCloseTo(0);
    expect(anchor.y).toBeCloseTo(-40);
  });

  it("points downward when target is directly below", () => {
    const anchor = getAnchorPoint(origin, down, 40);
    expect(anchor.x).toBeCloseTo(0);
    expect(anchor.y).toBeCloseTo(40);
  });

  it("handles same-point gracefully (no division by zero)", () => {
    const anchor = getAnchorPoint(origin, origin, 40);
    expect(Number.isFinite(anchor.x)).toBe(true);
    expect(Number.isFinite(anchor.y)).toBe(true);
  });
});

// ─── bezierPoint ─────────────────────────────────────────────────────────────

describe("bezierPoint", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 33, y: 0 };
  const p2 = { x: 66, y: 0 };
  const p3 = { x: 100, y: 0 };

  it("returns p0 at t=0", () => {
    const pt = bezierPoint(p0, p1, p2, p3, 0);
    expect(pt).toEqual(p0);
  });

  it("returns p3 at t=1", () => {
    const pt = bezierPoint(p0, p1, p2, p3, 1);
    expect(pt.x).toBeCloseTo(p3.x);
    expect(pt.y).toBeCloseTo(p3.y);
  });

  it("is symmetric for a collinear bezier (t=0.5 returns midpoint)", () => {
    // Use exact 1/3 and 2/3 positions so the bezier is uniformly parameterised
    // and B(0.5) equals the geometric midpoint.
    const third = 100 / 3;
    const twoThirds = 200 / 3;
    const pt = bezierPoint(
      p0,
      { x: third, y: 0 },
      { x: twoThirds, y: 0 },
      p3,
      0.5
    );
    expect(pt.x).toBeCloseTo(50);
    expect(pt.y).toBeCloseTo(0);
  });

  it("works with a curved path (non-collinear control points)", () => {
    const cp1 = { x: 0, y: -100 };
    const cp2 = { x: 100, y: -100 };
    const pt = bezierPoint(p0, cp1, cp2, p3, 0.5);
    // Should be above the midpoint due to the curve
    expect(pt.y).toBeLessThan(0);
  });
});

// ─── isBezierEdgeRoute ────────────────────────────────────────────────────────

describe("isBezierEdgeRoute", () => {
  it("returns true for 'curved'", () => {
    expect(isBezierEdgeRoute("curved")).toBe(true);
  });

  it("returns true for 's-curved'", () => {
    expect(isBezierEdgeRoute("s-curved")).toBe(true);
  });

  it("returns false for 'straight'", () => {
    expect(isBezierEdgeRoute("straight")).toBe(false);
  });

  it("returns false for 'angled'", () => {
    expect(isBezierEdgeRoute("angled")).toBe(false);
  });
});

// ─── getEdgeControlPoints ─────────────────────────────────────────────────────

describe("getEdgeControlPoints", () => {
  it("returns finite control points for curved route", () => {
    const { c1, c2 } = getEdgeControlPoints(origin, right, 1, "curved");
    expect(Number.isFinite(c1.x)).toBe(true);
    expect(Number.isFinite(c1.y)).toBe(true);
    expect(Number.isFinite(c2.x)).toBe(true);
    expect(Number.isFinite(c2.y)).toBe(true);
  });

  it("returns finite control points for s-curved route", () => {
    const { c1, c2 } = getEdgeControlPoints(origin, right, 1, "s-curved");
    expect(Number.isFinite(c1.x)).toBe(true);
    expect(Number.isFinite(c2.x)).toBe(true);
  });

  it("s-curved c1 leaves source horizontally (y matches source)", () => {
    const { c1 } = getEdgeControlPoints(origin, right, 1, "s-curved");
    expect(c1.y).toBeCloseTo(origin.y);
  });

  it("s-curved c2 approaches target horizontally (y matches target)", () => {
    const { c2 } = getEdgeControlPoints(origin, right, 1, "s-curved");
    expect(c2.y).toBeCloseTo(right.y);
  });

  describe("s-curved on a vertical run", () => {
    // A port-to-port edge between the bottom of one node and the top of another
    // is essentially vertical. Horizontal handles get clamped against a ~zero
    // horizontal span, which flattens the curve into a straight line.
    const below = { x: 4, y: 260 };

    it("leaves the source vertically instead of sideways", () => {
      const { c1 } = getEdgeControlPoints(origin, below, 1, "s-curved");
      expect(c1.x).toBeCloseTo(origin.x);
      expect(c1.y).toBeGreaterThan(origin.y);
    });

    it("approaches the target vertically", () => {
      const { c2 } = getEdgeControlPoints(origin, below, 1, "s-curved");
      expect(c2.x).toBeCloseTo(below.x);
      expect(c2.y).toBeLessThan(below.y);
    });

    it("actually bends rather than collapsing to a straight line", () => {
      const { c1, c2 } = getEdgeControlPoints(origin, below, 1, "s-curved");
      // Both handles must be well clear of their endpoints, otherwise the
      // cubic degenerates towards the straight chord.
      expect(Math.abs(c1.y - origin.y)).toBeGreaterThan(30);
      expect(Math.abs(c2.y - below.y)).toBeGreaterThan(30);
    });

    it("responds to curveStrength, which the horizontal clamp used to swallow", () => {
      const weak = getEdgeControlPoints(origin, below, 0.5, "s-curved");
      const strong = getEdgeControlPoints(origin, below, 2, "s-curved");
      expect(Math.abs(strong.c1.y - origin.y)).toBeGreaterThan(
        Math.abs(weak.c1.y - origin.y)
      );
    });

    it("never lets the handles cross the midpoint", () => {
      const { c1, c2 } = getEdgeControlPoints(origin, below, 10, "s-curved");
      const mid = (origin.y + below.y) / 2;
      expect(c1.y).toBeLessThanOrEqual(mid + 0.001);
      expect(c2.y).toBeGreaterThanOrEqual(mid - 0.001);
    });

    it("still uses horizontal handles when the run is mostly horizontal", () => {
      const { c1 } = getEdgeControlPoints(origin, { x: 260, y: 4 }, 1, "s-curved");
      expect(c1.y).toBeCloseTo(origin.y);
      expect(c1.x).toBeGreaterThan(origin.x);
    });

    it("handles an upward run by pointing the source handle up", () => {
      const above = { x: 4, y: -260 };
      const { c1, c2 } = getEdgeControlPoints(origin, above, 1, "s-curved");
      expect(c1.y).toBeLessThan(origin.y);
      expect(c2.y).toBeGreaterThan(above.y);
    });
  });

  it("curved route bows perpendicular to the source-target axis", () => {
    // Horizontal edge: control points should be offset vertically
    const { c1 } = getEdgeControlPoints(origin, right, 1, "curved");
    expect(c1.y).not.toBeCloseTo(0);
  });

  it("zero curve strength returns no perpendicular bend for curved route", () => {
    const { c1, c2 } = getEdgeControlPoints(origin, right, 0, "curved");
    expect(c1.y).toBeCloseTo(0);
    expect(c2.y).toBeCloseTo(0);
  });
});

// ─── resolveEdgeRouteType ─────────────────────────────────────────────────────

describe("resolveEdgeRouteType", () => {
  const src = node("src");
  const tgt = node("tgt");

  it("returns 'straight' by default (no callback)", () => {
    const result = resolveEdgeRouteType(undefined, src, tgt, origin, right, "edge");
    expect(result).toBe("straight");
  });

  it("delegates to the custom callback", () => {
    const result = resolveEdgeRouteType(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      () => "curved"
    );
    expect(result).toBe("curved");
  });

  it("passes phase correctly to the callback", () => {
    let capturedPhase: string | undefined;
    resolveEdgeRouteType(undefined, src, tgt, origin, right, "preview", ({ phase }) => {
      capturedPhase = phase;
      return "straight";
    });
    expect(capturedPhase).toBe("preview");
  });
});

// ─── resolveEdgeCurveStrength ─────────────────────────────────────────────────

describe("resolveEdgeCurveStrength", () => {
  const src = node("src");
  const tgt = node("tgt");

  it("returns 1 by default (no callback)", () => {
    expect(resolveEdgeCurveStrength(undefined, src, tgt, origin, right, "edge")).toBe(1);
  });

  it("returns the callback value", () => {
    const result = resolveEdgeCurveStrength(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      () => 2.5
    );
    expect(result).toBeCloseTo(2.5);
  });

  it("clamps negative values to 0", () => {
    const result = resolveEdgeCurveStrength(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      () => -3
    );
    expect(result).toBe(0);
  });

  it("falls back to 1 for non-finite values (NaN)", () => {
    const result = resolveEdgeCurveStrength(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      () => NaN
    );
    expect(result).toBe(1);
  });

  it("falls back to 1 for Infinity", () => {
    const result = resolveEdgeCurveStrength(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      () => Infinity
    );
    expect(result).toBe(1);
  });
});

// ─── getEdgeRouteGeometry ─────────────────────────────────────────────────────

describe("getEdgeRouteGeometry", () => {
  it("arrowTip always equals target for all route types", () => {
    const target = { x: 200, y: 150 };
    for (const route of ["straight", "curved", "s-curved", "angled"] as const) {
      const geo = getEdgeRouteGeometry(origin, target, route);
      expect(geo.arrowTip).toEqual(target);
    }
  });

  it("straight route has exactly 2 pick points", () => {
    const geo = getEdgeRouteGeometry(origin, right, "straight");
    expect(geo.pickPoints).toHaveLength(2);
  });

  it("straight route path starts with M", () => {
    const geo = getEdgeRouteGeometry(origin, right, "straight");
    expect(geo.path).toMatch(/^M/);
  });

  it("curved route path is a cubic bezier (contains C)", () => {
    const geo = getEdgeRouteGeometry(origin, right, "curved");
    expect(geo.path).toMatch(/C/);
  });

  it("s-curved route path is a cubic bezier (contains C)", () => {
    const geo = getEdgeRouteGeometry(origin, right, "s-curved");
    expect(geo.path).toMatch(/C/);
  });

  it("angled route has exactly 4 points for a horizontal-dominant edge", () => {
    const geo = getEdgeRouteGeometry(origin, { x: 200, y: 10 }, "angled");
    expect(geo.points).toHaveLength(4);
  });

  it("label position is finite for all route types", () => {
    for (const route of ["straight", "curved", "s-curved", "angled"] as const) {
      const geo = getEdgeRouteGeometry(origin, right, route);
      expect(Number.isFinite(geo.labelPosition.x)).toBe(true);
      expect(Number.isFinite(geo.labelPosition.y)).toBe(true);
    }
  });
});

// ─── buildEdgePath ────────────────────────────────────────────────────────────

describe("buildEdgePath", () => {
  it("returns a string starting with M", () => {
    const path = buildEdgePath(origin, right);
    expect(typeof path).toBe("string");
    expect(path.startsWith("M")).toBe(true);
  });

  it("includes the cubic bezier command (C)", () => {
    const path = buildEdgePath(origin, right);
    expect(path).toContain("C");
  });

  it("embeds the source coordinates", () => {
    const path = buildEdgePath({ x: 10, y: 20 }, { x: 100, y: 200 });
    expect(path).toContain("10");
    expect(path).toContain("20");
  });
});

describe("getVisibleGraphRect", () => {
  it("returns the container box in graph units at identity", () => {
    const r = getVisibleGraphRect({ x: 0, y: 0, zoom: 1 }, 800, 600);
    // Note: minX/minY are -0 here (negating zero), which compares equal to 0.
    expect(r.minX).toBeCloseTo(0);
    expect(r.minY).toBeCloseTo(0);
    expect(r.maxX).toBeCloseTo(800);
    expect(r.maxY).toBeCloseTo(600);
  });

  it("shifts opposite to the pan offset", () => {
    // Panning content right by 100px means graph x=-100 is at the left edge.
    const r = getVisibleGraphRect({ x: 100, y: 50, zoom: 1 }, 800, 600);
    expect(r.minX).toBe(-100);
    expect(r.minY).toBe(-50);
    expect(r.maxX).toBe(700);
    expect(r.maxY).toBe(550);
  });

  it("covers more graph area as zoom falls", () => {
    const wide = getVisibleGraphRect({ x: 0, y: 0, zoom: 0.1 }, 800, 600);
    expect(wide.maxX - wide.minX).toBeCloseTo(8000);
    expect(wide.maxY - wide.minY).toBeCloseTo(6000);

    const tight = getVisibleGraphRect({ x: 0, y: 0, zoom: 4 }, 800, 600);
    expect(tight.maxX - tight.minX).toBeCloseTo(200);
  });

  it("agrees with the inverse screen->graph transform at both corners", () => {
    const viewport = { x: -320, y: 75, zoom: 0.65 };
    const [w, h] = [1024, 768];
    const toGraph = (px: number, py: number) => ({
      x: (px - viewport.x) / viewport.zoom,
      y: (py - viewport.y) / viewport.zoom,
    });
    const rect = getVisibleGraphRect(viewport, w, h);
    expect(rect.minX).toBeCloseTo(toGraph(0, 0).x);
    expect(rect.minY).toBeCloseTo(toGraph(0, 0).y);
    expect(rect.maxX).toBeCloseTo(toGraph(w, h).x);
    expect(rect.maxY).toBeCloseTo(toGraph(w, h).y);
  });
});

// ─── getNodeAnchor ────────────────────────────────────────────────────────────

describe("getNodeAnchor", () => {
  it("falls back to getAnchorPoint at the default radius", () => {
    const anchor = getNodeAnchor(node("a"), origin, right);
    expect(anchor).toEqual({ x: DEFAULT_NODE_RADIUS, y: 0 });
  });

  it("honours a custom radius callback", () => {
    const anchor = getNodeAnchor(node("a"), origin, right, () => 10);
    expect(anchor).toEqual({ x: 10, y: 0 });
  });

  it("short-circuits to the custom anchor, ignoring the radius", () => {
    const custom = { x: 7, y: 9 };
    const anchor = getNodeAnchor(node("a"), origin, right, () => 999, () => custom);
    expect(anchor).toBe(custom);
  });

  it("passes node, position and target to the custom anchor", () => {
    const n = node("a");
    let seen: unknown;
    getNodeAnchor(n, origin, right, undefined, (props) => {
      seen = props;
      return origin;
    });
    expect(seen).toEqual({ node: n, position: origin, target: right });
  });
});

// ─── getEdgeAnchors ───────────────────────────────────────────────────────────

describe("getEdgeAnchors", () => {
  const src = node("s");
  const tgt = node("t");
  const positions: Record<string, NodePosition> = { s: origin, t: right };

  it("returns null when the source has no position", () => {
    expect(getEdgeAnchors(src, tgt, { t: right })).toBeNull();
  });

  it("returns null when the target has no position", () => {
    expect(getEdgeAnchors(src, tgt, { s: origin })).toBeNull();
  });

  it("anchors each endpoint on its own perimeter, facing the other", () => {
    const anchors = getEdgeAnchors(src, tgt, positions, () => 10)!;
    expect(anchors.source).toEqual({ x: 10, y: 0 });
    expect(anchors.target).toEqual({ x: 90, y: 0 });
  });

  it("propagates the custom anchor to both endpoints", () => {
    const seen: string[] = [];
    getEdgeAnchors(src, tgt, positions, undefined, ({ node: n }) => {
      seen.push(n.id);
      return origin;
    });
    expect(seen).toEqual(["s", "t"]);
  });
});

// ─── resolveEdgeControlPoints ─────────────────────────────────────────────────

describe("resolveEdgeControlPoints", () => {
  const src = node("s");
  const tgt = node("t");
  type Override = { c1?: NodePosition; c2?: NodePosition } | null | undefined;
  type CustomCp = (props: {
    route: EdgeRouteType;
    defaultControlPoints: { c1: NodePosition; c2: NodePosition };
  }) => Override;

  const resolve = (route: EdgeRouteType, getCustom?: CustomCp) =>
    resolveEdgeControlPoints<unknown, unknown>(
      undefined,
      src,
      tgt,
      origin,
      right,
      "edge",
      route,
      1,
      getCustom
    );

  it("returns undefined for non-bezier routes", () => {
    expect(resolve("straight")).toBeUndefined();
    expect(resolve("angled")).toBeUndefined();
  });

  it("returns the defaults when no override callback is given", () => {
    expect(resolve("curved")).toEqual(getEdgeControlPoints(origin, right, 1, "curved"));
  });

  it("returns the defaults when the callback returns null/undefined", () => {
    const defaults = getEdgeControlPoints(origin, right, 1, "curved");
    expect(resolve("curved", () => null)).toEqual(defaults);
    expect(resolve("curved", () => undefined)).toEqual(defaults);
  });

  it("applies a full override", () => {
    const c1 = { x: 1, y: 2 };
    const c2 = { x: 3, y: 4 };
    expect(resolve("curved", () => ({ c1, c2 }))).toEqual({ c1, c2 });
  });

  it("merges a partial override with the defaults", () => {
    const defaults = getEdgeControlPoints(origin, right, 1, "curved");
    const c1 = { x: 1, y: 2 };
    expect(resolve("curved", () => ({ c1 }))).toEqual({ c1, c2: defaults.c2 });
  });

  it("rejects non-finite override coordinates and keeps the default", () => {
    const defaults = getEdgeControlPoints(origin, right, 1, "curved");
    const result = resolve("curved", () => ({
      c1: { x: Number.NaN, y: 0 },
      c2: { x: Number.POSITIVE_INFINITY, y: 0 },
    }));
    expect(result).toEqual(defaults);
  });

  it("hands the defaults and route to the override callback", () => {
    let seenRoute: EdgeRouteType | undefined;
    let seenDefaults: unknown;
    resolve("s-curved", (props) => {
      seenRoute = props.route;
      seenDefaults = props.defaultControlPoints;
      return null;
    });
    expect(seenRoute).toBe("s-curved");
    expect(seenDefaults).toEqual(getEdgeControlPoints(origin, right, 1, "s-curved"));
  });
});
