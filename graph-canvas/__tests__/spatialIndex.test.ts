import { describe, it, expect, beforeEach } from "vitest";
import { SpatialIndex } from "../spatialIndex";
import type { GraphNode, NodePosition } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const r = () => 10;

function node(id: string): GraphNode<unknown> {
  return { id, data: null };
}

function pos(x: number, y: number): NodePosition {
  return { x, y };
}

const RADIUS = 40;
const getRadius = () => RADIUS;

// ─── rebuild + search ─────────────────────────────────────────────────────────

describe("SpatialIndex.rebuild + search", () => {
  let index: SpatialIndex<unknown>;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  it("returns an empty array when the index is empty", () => {
    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    expect(hits).toHaveLength(0);
  });

  it("finds a node whose bounding box intersects the search region", () => {
    const nodes = [node("a")];
    const positions = { a: pos(0, 0) };
    index.rebuild(nodes, positions, getRadius);
    const hits = index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(hits.map((h) => h.id)).toContain("a");
  });

  it("does not return a node whose bounding box is outside the search region", () => {
    const nodes = [node("a")];
    const positions = { a: pos(500, 500) };
    index.rebuild(nodes, positions, getRadius);
    const hits = index.search({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(hits).toHaveLength(0);
  });

  it("finds all nodes within a large search region", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const positions = {
      a: pos(0, 0),
      b: pos(200, 0),
      c: pos(0, 200),
    };
    index.rebuild(nodes, positions, getRadius);
    const hits = index.search({ minX: -100, minY: -100, maxX: 300, maxY: 300 });
    expect(hits.map((h) => h.id).toSorted()).toEqual(["a", "b", "c"]);
  });

  it("skips nodes that have no position", () => {
    const nodes = [node("a"), node("no-pos")];
    const positions = { a: pos(0, 0) }; // "no-pos" is absent
    index.rebuild(nodes, positions, getRadius);
    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    expect(hits.map((h) => h.id)).not.toContain("no-pos");
  });

  it("clears previous data on rebuild", () => {
    const first = [node("old")];
    index.rebuild(first, { old: pos(0, 0) }, getRadius);

    const second = [node("new")];
    index.rebuild(second, { new: pos(0, 0) }, getRadius);

    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    expect(hits.map((h) => h.id)).not.toContain("old");
    expect(hits.map((h) => h.id)).toContain("new");
  });
});

// ─── nearest ─────────────────────────────────────────────────────────────────

describe("SpatialIndex.nearest", () => {
  let index: SpatialIndex<unknown>;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  it("returns null when index is empty", () => {
    expect(index.nearest(0, 0, 100)).toBeNull();
  });

  it("returns null when no node is within maxRadius", () => {
    index.rebuild([node("a")], { a: pos(500, 500) }, getRadius);
    expect(index.nearest(0, 0, 100)).toBeNull();
  });

  it("returns the id of the nearest node within maxRadius", () => {
    const nodes = [node("a"), node("b")];
    const positions = { a: pos(10, 0), b: pos(300, 0) };
    index.rebuild(nodes, positions, getRadius);
    expect(index.nearest(0, 0, 200)).toBe("a");
  });

  it("returns the closest of multiple nearby nodes", () => {
    const nodes = [node("near"), node("far")];
    const positions = { near: pos(5, 0), far: pos(50, 0) };
    index.rebuild(nodes, positions, getRadius);
    expect(index.nearest(0, 0, 200)).toBe("near");
  });

  it("excludes the specified node id", () => {
    const nodes = [node("exclude"), node("other")];
    const positions = { exclude: pos(0, 0), other: pos(100, 0) };
    index.rebuild(nodes, positions, getRadius);
    expect(index.nearest(0, 0, 200, "exclude")).toBe("other");
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe("SpatialIndex.update", () => {
  it("reflects updated position in next search", () => {
    const index = new SpatialIndex<unknown>();
    const n = node("a");
    index.rebuild([n], { a: pos(500, 500) }, getRadius);

    // Move node to origin
    index.update(n, pos(0, 0), getRadius);

    const hits = index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(hits.map((h) => h.id)).toContain("a");
  });

  it("old position is no longer returned after update", () => {
    const index = new SpatialIndex<unknown>();
    const n = node("a");
    index.rebuild([n], { a: pos(0, 0) }, getRadius);

    index.update(n, pos(500, 500), getRadius);

    const hits = index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(hits.map((h) => h.id)).not.toContain("a");
  });
});

// ─── remove ──────────────────────────────────────────────────────────────────

describe("SpatialIndex.remove", () => {
  it("removed node is not returned by subsequent searches", () => {
    const index = new SpatialIndex<unknown>();
    index.rebuild([node("a"), node("b")], { a: pos(0, 0), b: pos(200, 0) }, getRadius);

    index.remove(["a"]);

    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    expect(hits.map((h) => h.id)).not.toContain("a");
    expect(hits.map((h) => h.id)).toContain("b");
  });

  it("is a no-op for an unknown id", () => {
    const index = new SpatialIndex<unknown>();
    index.rebuild([node("a")], { a: pos(0, 0) }, getRadius);

    // Should not throw
    expect(() => index.remove(["does-not-exist"])).not.toThrow();

    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    expect(hits.map((h) => h.id)).toContain("a");
  });

  it("can remove multiple nodes at once", () => {
    const index = new SpatialIndex<unknown>();
    index.rebuild(
      [node("a"), node("b"), node("c")],
      { a: pos(0, 0), b: pos(100, 0), c: pos(200, 0) },
      getRadius
    );

    index.remove(["a", "b"]);

    const hits = index.search({ minX: -999, minY: -999, maxX: 999, maxY: 999 });
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).toContain("c");
  });
});

// ─── updateBatch (untested in v1) ─────────────────────────────────────────────

describe("SpatialIndex.updateBatch", () => {

  it("moves several nodes at once", () => {
    const index = new SpatialIndex();
    const nodes = [node("a"), node("b")];
    index.rebuild(nodes, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, r);
    index.updateBatch(nodes, { a: { x: 500, y: 500 }, b: { x: 600, y: 500 } }, r);

    expect(index.search({ minX: -20, minY: -20, maxX: 20, maxY: 20 })).toHaveLength(0);
    expect(index.search({ minX: 480, minY: 480, maxX: 620, maxY: 520 })).toHaveLength(2);
  });

  it("skips nodes that have no position", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a")], { a: { x: 0, y: 0 } }, r);
    index.updateBatch([node("a"), node("b")], { a: { x: 50, y: 0 } }, r);
    expect(index.nearest(50, 0, 20)).toBe("a");
    expect(index.nearest(0, 0, 5)).toBeNull();
  });

  it("does not clear entries absent from the batch (unlike rebuild)", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a"), node("b")], { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, r);
    index.updateBatch([node("a")], { a: { x: 200, y: 0 } }, r);
    // b was not in the batch but must survive.
    expect(index.nearest(100, 0, 20)).toBe("b");
    expect(index.nearest(200, 0, 20)).toBe("a");
  });

  it("interleaves correctly with remove", () => {
    const index = new SpatialIndex();
    const nodes = [node("a"), node("b")];
    index.rebuild(nodes, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, r);
    index.remove(["a"]);
    index.updateBatch(nodes, { a: { x: 10, y: 0 }, b: { x: 110, y: 0 } }, r);
    // "a" was removed then re-added by the batch.
    expect(index.nearest(10, 0, 20)).toBe("a");
    expect(index.nearest(110, 0, 20)).toBe("b");
  });
});

// ─── pickAt (v2 only) ─────────────────────────────────────────────────────────

describe("SpatialIndex.pickAt", () => {
  it("returns a node whose bbox contains the point, even beyond `tolerance`", () => {
    const index = new SpatialIndex();
    // Half-side 100, so (80,0) is inside the bbox but 80 away from the centre.
    index.rebuild([node("big")], { big: { x: 0, y: 0 } }, () => 100);
    expect(index.pickAt(80, 0, 1)).toBe("big");
  });

  it("prefers the nearest centre among overlapping bboxes", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a"), node("b")], { a: { x: 0, y: 0 }, b: { x: 60, y: 0 } }, () => 100);
    // Both bboxes contain (50,0); b's centre is closer.
    expect(index.pickAt(50, 0, 1)).toBe("b");
  });

  it("falls back to nearest-centre when no bbox contains the point", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a")], { a: { x: 0, y: 0 } }, () => 10);
    // (30,0) is outside the 10-radius bbox but within a 50 tolerance.
    expect(index.pickAt(30, 0, 50)).toBe("a");
  });

  it("returns null when nothing is within tolerance", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a")], { a: { x: 0, y: 0 } }, () => 10);
    expect(index.pickAt(500, 500, 20)).toBeNull();
  });

  it("honours `exclude` in the containing pass", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a")], { a: { x: 0, y: 0 } }, () => 100);
    expect(index.pickAt(10, 0, 1, "a")).toBeNull();
  });

  it("honours `exclude` in the nearest fallback", () => {
    const index = new SpatialIndex();
    index.rebuild([node("a"), node("b")], { a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, () => 5);
    // (20,0) is in neither bbox; excluding the closer one yields the other.
    expect(index.pickAt(22, 0, 100, "b")).toBe("a");
  });
});

// ─── shape-aware bounds ───────────────────────────────────────────────────────

describe("SpatialIndex shape-aware bounds", () => {
  it("hit-tests a rectangle node by the drawn rectangle, not the radius square", () => {
    const index = new SpatialIndex();
    index.configureShape(() => "rectangle");
    // Default radius 40, but the canvas layer paints rectangles at 168×108 —
    // (70, 0) is outside the radius square yet inside the painted shape.
    index.rebuild([node("a")], { a: pos(0, 0) }, getRadius);
    expect(index.pickAt(70, 0, 0)).toBe("a");
    // (0, 70) is outside the rectangle's 54 half-height.
    expect(index.pickAt(0, 70, 0)).toBeNull();
  });

  it("unions the rectangle with the radius, never shrinking a compensated hit-box", () => {
    const index = new SpatialIndex();
    index.configureShape(() => "rectangle");
    // A consumer who compensated with radius 90 keeps that vertical extent.
    index.rebuild([node("a")], { a: pos(0, 0) }, () => 90);
    expect(index.pickAt(0, 85, 0)).toBe("a");
  });

  it("resolves the shape from node data when no shape function is configured", () => {
    const index = new SpatialIndex<{ shape: string }>();
    index.rebuild(
      [{ id: "a", data: { shape: "rectangle" } }],
      { a: pos(0, 0) },
      getRadius
    );
    expect(index.pickAt(70, 0, 0)).toBe("a");
  });

  it("keeps plain radius bounds for circle nodes", () => {
    const index = new SpatialIndex();
    index.configureShape(() => "circle");
    index.rebuild([node("a")], { a: pos(0, 0) }, getRadius);
    expect(index.pickAt(70, 0, 0)).toBeNull();
  });
});

// ─── bulk load + reference-equality removal (v2 optimisation guard) ───────────

describe("SpatialIndex bulk behaviour", () => {
  it("removes correctly after a bulk load of 100 nodes", () => {
    // v2 removes by object reference rather than an id predicate; RBush uses a
    // different internal path above ~9 items, so exercise it at scale.
    const index = new SpatialIndex();
    const nodes = Array.from({ length: 100 }, (_, i) => node(`n${i}`));
    const positions: Record<string, NodePosition> = {};
    for (let i = 0; i < 100; i++) positions[`n${i}`] = { x: i * 30, y: 0 };
    index.rebuild(nodes, positions, () => 5);

    index.remove(["n50"]);
    expect(index.nearest(50 * 30, 0, 10)).toBeNull();
    expect(index.nearest(49 * 30, 0, 10)).toBe("n49");
    expect(index.search({ minX: -50, minY: -50, maxX: 100 * 30, maxY: 50 })).toHaveLength(99);
  });
});
