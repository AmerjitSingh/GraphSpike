import { describe, it, expect } from "vitest";
import { createGraphCanvasStore, filterFinitePositions } from "../store";
import type { NodePosition } from "../types";

const pos = (x: number, y: number): NodePosition => ({ x, y });

describe("createGraphCanvasStore — initial state", () => {
  it("starts empty and unzoomed", () => {
    const s = createGraphCanvasStore().getState();
    expect(s.positions).toEqual({});
    expect(s.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(s.selectedNodeIds).toEqual([]);
    expect(s.transientDepth).toBe(0);
  });

  it("deep-copies the seed rather than aliasing the caller's objects", () => {
    // Both levels need copying: reassigning `seed.a` tests the record, while
    // mutating `point.x` tests the coordinate object that can carry NaN later.
    const point = pos(1, 2);
    const seed = { a: point };
    const store = createGraphCanvasStore(seed);
    expect(store.getState().positions).not.toBe(seed);
    expect(store.getState().positions.a).not.toBe(point);
    expect(store.getState().positions).toEqual(seed);

    point.x = Number.NaN;
    expect(store.getState().positions.a).toEqual(pos(1, 2));

    seed.a = pos(99, 99);
    expect(store.getState().positions.a).toEqual(pos(1, 2));
  });
});

describe("positions", () => {
  it("setNodePosition adds and overwrites", () => {
    const store = createGraphCanvasStore();
    store.getState().setNodePosition("a", 1, 2);
    expect(store.getState().positions.a).toEqual(pos(1, 2));
    store.getState().setNodePosition("a", 3, 4);
    expect(store.getState().positions.a).toEqual(pos(3, 4));
  });

  it("setNodePositions applies every update, last write winning per id", () => {
    const store = createGraphCanvasStore();
    store.getState().setNodePositions([
      { id: "a", x: 1, y: 1 },
      { id: "b", x: 2, y: 2 },
      { id: "a", x: 9, y: 9 },
    ]);
    expect(store.getState().positions).toEqual({ a: pos(9, 9), b: pos(2, 2) });
  });

  it("setNodePositions([]) leaves the contents unchanged", () => {
    const store = createGraphCanvasStore({ a: pos(1, 1) });
    store.getState().setNodePositions([]);
    expect(store.getState().positions).toEqual({ a: pos(1, 1) });
  });
});

describe("setViewport", () => {
  it("replaces the viewport wholesale", () => {
    const store = createGraphCanvasStore();
    store.getState().setViewport({ x: 10, y: 20, zoom: 2 });
    expect(store.getState().viewport).toEqual({ x: 10, y: 20, zoom: 2 });
  });
});

describe("setSelection", () => {
  it("deduplicates the incoming ids", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "a", "b"]);
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });

  it("is a no-op (same state object) for an equal set in a different order", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "b"]);
    const before = store.getState();
    store.getState().setSelection(["b", "a"]);
    expect(store.getState()).toBe(before);
  });

  it("updates when the set actually differs", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "b"]);
    const before = store.getState();
    store.getState().setSelection(["a"]);
    expect(store.getState()).not.toBe(before);
    expect(store.getState().selectedNodeIds).toEqual(["a"]);
  });

  it("treats a same-size but different set as a change", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "b"]);
    store.getState().setSelection(["a", "c"]);
    expect(store.getState().selectedNodeIds).toEqual(["a", "c"]);
  });
});

describe("toggleSelection", () => {
  it("appends an unselected id at the tail", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a"]);
    store.getState().toggleSelection("b");
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });

  it("removes an already-selected id", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "b"]);
    store.getState().toggleSelection("a");
    expect(store.getState().selectedNodeIds).toEqual(["b"]);
  });

  it("round-trips back to the original set", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a"]);
    store.getState().toggleSelection("b");
    store.getState().toggleSelection("b");
    expect(store.getState().selectedNodeIds).toEqual(["a"]);
  });
});

describe("clearSelection", () => {
  it("empties a non-empty selection", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a"]);
    store.getState().clearSelection();
    expect(store.getState().selectedNodeIds).toEqual([]);
  });

  it("is a no-op (same state object) when already empty", () => {
    const store = createGraphCanvasStore();
    const before = store.getState();
    store.getState().clearSelection();
    expect(store.getState()).toBe(before);
  });
});

describe("pruneToNodes", () => {
  it("is a no-op (same state object) when nothing is stale", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0) });
    store.getState().setSelection(["a"]);
    const before = store.getState();
    store.getState().pruneToNodes(["a"]);
    expect(store.getState()).toBe(before);
  });

  it("drops positions for removed nodes", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0), b: pos(1, 1) });
    store.getState().pruneToNodes(["a"]);
    expect(store.getState().positions).toEqual({ a: pos(0, 0) });
  });

  it("drops selection entries for removed nodes", () => {
    const store = createGraphCanvasStore();
    store.getState().setSelection(["a", "b"]);
    store.getState().pruneToNodes(["a"]);
    expect(store.getState().selectedNodeIds).toEqual(["a"]);
  });

  it("preserves the selection array's identity when only positions changed", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0), stale: pos(9, 9) });
    store.getState().setSelection(["a"]);
    const beforeSelection = store.getState().selectedNodeIds;
    store.getState().pruneToNodes(["a"]);
    expect(store.getState().selectedNodeIds).toBe(beforeSelection);
    expect(store.getState().positions).toEqual({ a: pos(0, 0) });
  });

  it("preserves the positions object's identity when only the selection changed", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0) });
    store.getState().setSelection(["a", "ghost"]);
    const beforePositions = store.getState().positions;
    store.getState().pruneToNodes(["a"]);
    expect(store.getState().positions).toBe(beforePositions);
    expect(store.getState().selectedNodeIds).toEqual(["a"]);
  });

  it("prunes both at once", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0), stale: pos(9, 9) });
    store.getState().setSelection(["a", "ghost"]);
    store.getState().pruneToNodes(["a"]);
    expect(store.getState().positions).toEqual({ a: pos(0, 0) });
    expect(store.getState().selectedNodeIds).toEqual(["a"]);
  });

  it("pruning to an empty node list clears everything", () => {
    const store = createGraphCanvasStore({ a: pos(0, 0) });
    store.getState().setSelection(["a"]);
    store.getState().pruneToNodes([]);
    expect(store.getState().positions).toEqual({});
    expect(store.getState().selectedNodeIds).toEqual([]);
  });
});

describe("transient depth", () => {
  it("counts nested begins and ends", () => {
    const store = createGraphCanvasStore();
    store.getState().beginTransient();
    store.getState().beginTransient();
    expect(store.getState().transientDepth).toBe(2);
    store.getState().endTransient();
    expect(store.getState().transientDepth).toBe(1);
    store.getState().endTransient();
    expect(store.getState().transientDepth).toBe(0);
  });

  it("clamps at zero for an unbalanced end", () => {
    const store = createGraphCanvasStore();
    store.getState().endTransient();
    expect(store.getState().transientDepth).toBe(0);
  });
});

describe("filterFinitePositions", () => {
  it("drops non-finite coordinates", () => {
    expect(
      filterFinitePositions({
        ok: { x: 1, y: 2 },
        nan: { x: Number.NaN, y: 0 },
        inf: { x: 0, y: Number.POSITIVE_INFINITY },
      })
    ).toEqual({ ok: { x: 1, y: 2 } });
  });
});

describe("createGraphCanvasStore — seeding", () => {
  it("never admits a non-finite initial position", () => {
    // One NaN reaches the spatial index, the edge geometry and fitToView,
    // where it turns the whole viewport transform into NaN.
    const store = createGraphCanvasStore({
      good: { x: 5, y: 5 },
      bad: { x: Number.NaN, y: 0 },
    });
    expect(store.getState().positions.good).toEqual({ x: 5, y: 5 });
    expect(store.getState().positions.bad).toBeUndefined();
  });
});

describe("positions are prototype-safe", () => {
  // Node ids come from consumer data, so these are all legal ids. On a normal
  // object `positions["constructor"]` returns an inherited function, which
  // every `if (positions[id])` presence test in the library reads as "placed".
  const hazards = ["constructor", "toString", "__proto__", "hasOwnProperty"];

  it("reports no position for prototype-named ids on a fresh store", () => {
    const store = createGraphCanvasStore();
    for (const id of hazards) {
      expect(store.getState().positions[id]).toBeUndefined();
    }
  });

  it("still stores and reads them once actually placed", () => {
    const store = createGraphCanvasStore();
    act_set(store, "constructor", 4, 5);
    expect(store.getState().positions.constructor).toEqual({ x: 4, y: 5 });
    expect(store.getState().positions.toString).toBeUndefined();
  });

  it("keeps the null prototype across updates", () => {
    const store = createGraphCanvasStore({ a: { x: 0, y: 0 } });
    act_set(store, "a", 1, 1);
    expect(Object.getPrototypeOf(store.getState().positions)).toBeNull();
    store.getState().setNodePositions([{ id: "b", x: 2, y: 2 }]);
    expect(Object.getPrototypeOf(store.getState().positions)).toBeNull();
  });
});

describe("non-finite coordinates are refused everywhere", () => {
  it("ignores a NaN single write", () => {
    const store = createGraphCanvasStore({ a: { x: 1, y: 1 } });
    store.getState().setNodePosition("a", Number.NaN, 5);
    expect(store.getState().positions.a).toEqual({ x: 1, y: 1 });
  });

  it("ignores Infinity in a batch but keeps the valid entries", () => {
    const store = createGraphCanvasStore();
    store.getState().setNodePositions([
      { id: "good", x: 1, y: 2 },
      { id: "bad", x: Number.POSITIVE_INFINITY, y: 0 },
    ]);
    expect(store.getState().positions.good).toEqual({ x: 1, y: 2 });
    expect(store.getState().positions.bad).toBeUndefined();
  });

  it("does not churn state when every update is rejected", () => {
    const store = createGraphCanvasStore({ a: { x: 1, y: 1 } });
    const before = store.getState().positions;
    store.getState().setNodePositions([{ id: "a", x: Number.NaN, y: Number.NaN }]);
    expect(store.getState().positions).toBe(before);
  });
});

/** setNodePosition helper that keeps the hazard names readable above. */
function act_set(
  store: ReturnType<typeof createGraphCanvasStore>,
  id: string,
  x: number,
  y: number
) {
  store.getState().setNodePosition(id, x, y);
}
