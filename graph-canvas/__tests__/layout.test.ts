import { describe, it, expect } from "vitest";
import { getSeedPositions } from "../layout";
import type { GraphNode } from "../types";

// Mirrors the module-private constants in layout.ts.
const BASE_RING_GAP = 180;
const MIN_SPACING = 120;

/** Ring capacity for ring n, per the same formula the implementation uses. */
const capacity = (ring: number) =>
  Math.max(6, Math.floor((Math.PI * 2 * (ring * BASE_RING_GAP)) / MIN_SPACING));

function nodes(...ids: string[]): GraphNode<unknown>[] {
  return ids.map((id) => ({ id, data: null }));
}

function nNodes(n: number): GraphNode<unknown>[] {
  // Zero-padded so lexicographic order matches numeric order.
  return nodes(...Array.from({ length: n }, (_, i) => `n${String(i).padStart(3, "0")}`));
}

const radiusOf = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
const bearing = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);

describe("getSeedPositions — degenerate inputs", () => {
  it("returns an empty record for no nodes", () => {
    expect(getSeedPositions([])).toEqual({});
  });

  it("places a single node at the origin, not on a ring", () => {
    expect(getSeedPositions(nodes("solo"))).toEqual({ solo: { x: 0, y: 0 } });
  });

  it("collapses duplicate ids", () => {
    const result = getSeedPositions(nodes("a", "a", "b"));
    expect(Object.keys(result).toSorted()).toEqual(["a", "b"]);
  });

  it("returns an own entry for prototype-named node ids", () => {
    const result = getSeedPositions(nodes("__proto__", "constructor", "toString"));
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.keys(result).toSorted()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Number.isFinite(result.__proto__.x)).toBe(true);
    expect(Number.isFinite(result.__proto__.y)).toBe(true);
  });
});

describe("getSeedPositions — ring capacities", () => {
  it("ring 1 holds 9 nodes", () => {
    expect(capacity(1)).toBe(9);
    const result = getSeedPositions(nNodes(9));
    for (const p of Object.values(result)) {
      expect(radiusOf(p)).toBeCloseTo(BASE_RING_GAP);
    }
  });

  it("the 10th node starts ring 2 at radius 360", () => {
    const result = getSeedPositions(nNodes(10));
    const last = result["n009"];
    expect(radiusOf(last)).toBeCloseTo(2 * BASE_RING_GAP);
    // Alone on its ring: inRing = 1, step = 2π, startAngle = -π/2 + π = π/2.
    expect(last.x).toBeCloseTo(0);
    expect(last.y).toBeCloseTo(2 * BASE_RING_GAP);
  });

  it("ring 2 holds 18 and ring 3 holds 28", () => {
    expect(capacity(2)).toBe(18);
    expect(capacity(3)).toBe(28);
    const result = getSeedPositions(nNodes(9 + 18 + 28));
    const onRing = (r: number) =>
      Object.values(result).filter((p) => Math.abs(radiusOf(p) - r * BASE_RING_GAP) < 1e-6).length;
    expect(onRing(1)).toBe(9);
    expect(onRing(2)).toBe(18);
    expect(onRing(3)).toBe(28);
  });

  it("every node lands exactly on its ring radius", () => {
    const result = getSeedPositions(nNodes(40));
    for (const p of Object.values(result)) {
      const r = radiusOf(p) / BASE_RING_GAP;
      expect(Math.abs(r - Math.round(r))).toBeLessThan(1e-6);
    }
  });
});

describe("getSeedPositions — placement details", () => {
  it("starts ring 1 at the top (angle -π/2)", () => {
    const result = getSeedPositions(nNodes(9));
    const first = result["n000"];
    expect(first.x).toBeCloseTo(0);
    expect(first.y).toBeCloseTo(-BASE_RING_GAP);
  });

  it("offsets ring 2 by half a step so nodes don't radially align with ring 1", () => {
    const result = getSeedPositions(nNodes(9 + 18));
    const ring1 = bearing(result["n000"]);
    const ring2 = bearing(result["n009"]);
    const halfStep = Math.PI / 18; // (2π/18)/2
    // Ring 2's first node sits half a ring-2 step past the top.
    expect(ring2 - ring1).toBeCloseTo(halfStep);
  });

  it("assigns positions by sorted id, independent of input order", () => {
    const ordered = getSeedPositions(nodes("a", "b", "c", "d"));
    const shuffled = getSeedPositions(nodes("d", "b", "a", "c"));
    expect(shuffled).toEqual(ordered);
  });

  it("does not mutate the input array", () => {
    const input = nodes("c", "a", "b");
    const snapshot = input.map((n) => n.id);
    getSeedPositions(input);
    expect(input.map((n) => n.id)).toEqual(snapshot);
  });

  it("produces finite coordinates and one entry per node at scale", () => {
    const result = getSeedPositions(nNodes(200));
    expect(Object.keys(result)).toHaveLength(200);
    for (const p of Object.values(result)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("uses locale collation, so 'a' sorts before 'B'", () => {
    // localeCompare differs from code-unit order here ("B" < "a" by charCode).
    const result = getSeedPositions(nodes("B", "a"));
    // Two nodes → ring 1, first sorted id at the top.
    expect(result["a"].y).toBeCloseTo(-BASE_RING_GAP);
  });
});
