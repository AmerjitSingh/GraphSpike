// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { usePositionSync } from "../hooks/usePositionSync";
import { useForceLayout } from "../hooks/useForceLayout";
import { useGraphLinkBridge } from "../hooks/useGraphLinkBridge";
import { useSelectionSync } from "../hooks/useSelectionSync";
import { GraphCanvasStoreContext, createGraphCanvasStore } from "../store";
import type { GraphCanvasStore } from "../store";
import { createGraphLink } from "../link/GraphLink";
import type { GraphEdge, GraphNode, NodePosition } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const nodes: GraphNode<unknown>[] = [
  { id: "a", data: null },
  { id: "b", data: null },
];

const delimiterCollisionRadius = (node: GraphNode<unknown>) => node.id === "a" ? 1 : 2;

const wrapperFor = (store: GraphCanvasStore) =>
  ({ children }: { children: ReactNode }) => (
    <GraphCanvasStoreContext.Provider value={store}>{children}</GraphCanvasStoreContext.Provider>
  );

// ─── useSelectionSync ────────────────────────────────────────────────────────

describe("useSelectionSync — controlled ids", () => {
  it("does not collide when ids contain the old signature delimiter", () => {
    const store = createGraphCanvasStore();
    const { rerender } = renderHook(
      ({ selected }: { selected: string[] }) =>
        useSelectionSync({ controlledSelection: selected }),
      {
        initialProps: { selected: ["a,b"] },
        wrapper: wrapperFor(store),
      }
    );

    expect(store.getState().selectedNodeIds).toEqual(["a,b"]);
    rerender({ selected: ["a", "b"] });
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });
});

// ─── usePositionSync ──────────────────────────────────────────────────────────

describe("usePositionSync — seeding", () => {
  it("seeds nodes that have no position yet", () => {
    const store = createGraphCanvasStore();
    renderHook(
      () => usePositionSync({ nodes, initialPositions: { a: { x: 1, y: 2 } } }),
      { wrapper: wrapperFor(store) }
    );
    expect(store.getState().positions.a).toEqual({ x: 1, y: 2 });
  });

  it("does not overwrite a node that already has a position", () => {
    const store = createGraphCanvasStore({ a: { x: 9, y: 9 } });
    renderHook(
      () => usePositionSync({ nodes, initialPositions: { a: { x: 1, y: 2 } } }),
      { wrapper: wrapperFor(store) }
    );
    expect(store.getState().positions.a).toEqual({ x: 9, y: 9 });
  });

  it("ignores non-finite seed coordinates", () => {
    const store = createGraphCanvasStore();
    renderHook(
      () =>
        usePositionSync({
          nodes,
          initialPositions: {
            a: { x: Number.NaN, y: 0 },
            b: { x: Number.POSITIVE_INFINITY, y: 0 },
          },
        }),
      { wrapper: wrapperFor(store) }
    );
    expect(store.getState().positions.a).toBeUndefined();
    expect(store.getState().positions.b).toBeUndefined();
  });

  it("prunes positions for nodes that no longer exist", () => {
    const store = createGraphCanvasStore({ a: { x: 0, y: 0 }, gone: { x: 5, y: 5 } });
    renderHook(() => usePositionSync({ nodes, initialPositions: {} }), {
      wrapper: wrapperFor(store),
    });
    expect(store.getState().positions.gone).toBeUndefined();
    expect(store.getState().positions.a).toBeDefined();
  });
});

describe("usePositionSync — notification", () => {
  const positions: Record<string, NodePosition> = { a: { x: 0, y: 0 } };

  it("reports the committed positions", () => {
    const store = createGraphCanvasStore(positions);
    const onPositionsChange = vi.fn<(p: Record<string, NodePosition>) => void>();
    renderHook(
      () => usePositionSync({ nodes, initialPositions: {}, onPositionsChange }),
      { wrapper: wrapperFor(store) }
    );
    onPositionsChange.mockClear();
    act(() => { store.getState().setNodePosition("a", 5, 5); });
    expect(onPositionsChange).toHaveBeenCalledTimes(1);
  });

  it("publishes a detached position snapshot", () => {
    const store = createGraphCanvasStore(positions);
    const onPositionsChange = vi.fn<(p: Record<string, NodePosition>) => void>();
    renderHook(
      () => usePositionSync({ nodes, initialPositions: {}, onPositionsChange }),
      { wrapper: wrapperFor(store) }
    );
    const published = onPositionsChange.mock.calls[0][0];
    published.a.x = Number.NaN;
    published.injected = { x: 1, y: 2 };
    expect(store.getState().positions).toEqual(positions);
    expect(Number.isFinite(store.getState().positions.a.x)).toBe(true);
    expect(store.getState().positions.injected).toBeUndefined();
  });

  it("stays quiet during a transient phase, then fires once at the end", () => {
    const store = createGraphCanvasStore(positions);
    const onPositionsChange = vi.fn<(p: Record<string, NodePosition>) => void>();
    renderHook(
      () => usePositionSync({ nodes, initialPositions: {}, onPositionsChange }),
      { wrapper: wrapperFor(store) }
    );
    onPositionsChange.mockClear();

    act(() => { store.getState().beginTransient(); });
    act(() => { store.getState().setNodePosition("a", 1, 1); });
    act(() => { store.getState().setNodePosition("a", 2, 2); });
    act(() => { store.getState().setNodePosition("a", 3, 3); });
    expect(onPositionsChange).not.toHaveBeenCalled();

    act(() => { store.getState().endTransient(); });
    expect(onPositionsChange).toHaveBeenCalledTimes(1);
    expect(onPositionsChange.mock.calls[0][0].a).toEqual({ x: 3, y: 3 });
  });

  it("does not re-notify when nothing actually moved", () => {
    const store = createGraphCanvasStore(positions);
    const onPositionsChange = vi.fn<(p: Record<string, NodePosition>) => void>();
    renderHook(
      () => usePositionSync({ nodes, initialPositions: {}, onPositionsChange }),
      { wrapper: wrapperFor(store) }
    );
    onPositionsChange.mockClear();
    act(() => { store.getState().setViewport({ x: 10, y: 10, zoom: 2 }); });
    expect(onPositionsChange).not.toHaveBeenCalled();
  });
});

// ─── useForceLayout ───────────────────────────────────────────────────────────

/** Captures constructed workers so tests can drive their message handlers. */
function stubWorker() {
  const instances: {
    posted: unknown[];
    terminated: boolean;
    emit: (data: unknown) => void;
    emitError: (message: string) => void;
  }[] = [];

  class FakeWorker {
    // Keyed by event type, like a real Worker: a "message" listener must not
    // receive "error" events, and vice versa.
    private listeners = new Map<string, ((e: never) => void)[]>();
    posted: unknown[] = [];
    terminated = false;
    private dispatch(type: string, event: unknown) {
      for (const l of this.listeners.get(type) ?? []) (l as (e: unknown) => void)(event);
    }
    constructor() {
      instances.push({
        posted: this.posted,
        get terminated() { return false; },
        emit: (data: unknown) => { this.dispatch("message", { data }); },
        emitError: (message: string) => { this.dispatch("error", { message }); },
      } as never);
      // Keep a live reference so `terminated` reflects reality.
      instances[instances.length - 1] = Object.defineProperty(
        instances[instances.length - 1],
        "terminated",
        { get: () => this.terminated }
      );
    }
    addEventListener(type: string, fn: (e: never) => void) {
      const bucket = this.listeners.get(type);
      if (bucket) bucket.push(fn);
      else this.listeners.set(type, [fn]);
    }
    postMessage(msg: unknown) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
  }

  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  return instances;
}

const edges: GraphEdge<unknown>[] = [
  { id: "e1", source: "a", target: "b", data: null },
];

function renderForceLayout(store: GraphCanvasStore, over: Record<string, unknown> = {}) {
  return renderHook(
    () =>
      useForceLayout({
        nodes,
        edges,
        enabled: true,
        linkDistance: 140,
        chargeStrength: -400,
        getNodeRadius: () => 40,
        ...over,
      }),
    { wrapper: wrapperFor(store) }
  );
}

describe("useForceLayout — when it runs", () => {
  it("starts a worker when nodes need placing", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore());
    expect(workers).toHaveLength(1);
  });

  it("does nothing when disabled", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore(), { enabled: false });
    expect(workers).toHaveLength(0);
  });

  it("does nothing when there are no nodes", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore(), { nodes: [], edges: [] });
    expect(workers).toHaveLength(0);
  });

  it("does nothing when every node already has a position", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }));
    expect(workers).toHaveLength(0);
  });

  it("sends the simulation payload", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore());
    const payload = workers[0].posted[0] as Record<string, unknown>;
    expect(payload.linkDistance).toBe(140);
    expect(payload.chargeStrength).toBe(-400);
    expect((payload.nodes as unknown[])).toHaveLength(2);
    expect((payload.edges as unknown[])).toHaveLength(1);
    expect(typeof payload.totalTicks).toBe("number");
  });

  it("normalizes malformed force parameters and collision radii", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore(), {
      linkDistance: Number.NaN,
      chargeStrength: Number.POSITIVE_INFINITY,
      getNodeRadius: () => Number.NEGATIVE_INFINITY,
    });
    const payload = workers[0].posted[0] as {
      linkDistance: number;
      chargeStrength: number;
      nodeRadii: { id: string; r: number }[];
    };
    expect(payload.linkDistance).toBe(140);
    expect(payload.chargeStrength).toBe(-400);
    expect(payload.nodeRadii.map(({ r }) => r)).toEqual([40, 40]);
  });

  it("restarts when node ids collide under the old delimiter signature", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const firstNodes: GraphNode<unknown>[] = [
      { id: "a", data: null },
      { id: "b", data: null },
    ];
    const replacementNodes: GraphNode<unknown>[] = [
      { id: "a:1|b", data: null },
    ];
    const { rerender } = renderHook(
      ({ layoutNodes }: { layoutNodes: GraphNode<unknown>[] }) =>
        useForceLayout({
          nodes: layoutNodes,
          edges: [],
          enabled: true,
          linkDistance: 140,
          chargeStrength: -400,
          getNodeRadius: delimiterCollisionRadius,
        }),
      { initialProps: { layoutNodes: firstNodes }, wrapper: wrapperFor(store) }
    );
    expect(workers).toHaveLength(1);
    rerender({ layoutNodes: replacementNodes });
    expect(workers).toHaveLength(2);
  });

  it("restarts when edge ids collide under the old delimiter signature", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const graphNodes: GraphNode<unknown>[] = ["a", "b", "c", "d"].map((id) => ({
      id,
      data: null,
    }));
    const firstEdges: GraphEdge<unknown>[] = [
      { id: "e", source: "a", target: "b", data: null },
      { id: "f", source: "c", target: "d", data: null },
    ];
    const replacementEdges: GraphEdge<unknown>[] = [
      { id: "e", source: "a", target: "b|f:c->d", data: null },
    ];
    const { rerender } = renderHook(
      ({ layoutEdges }: { layoutEdges: GraphEdge<unknown>[] }) =>
        useForceLayout({
          nodes: graphNodes,
          edges: layoutEdges,
          enabled: true,
          linkDistance: 140,
          chargeStrength: -400,
          getNodeRadius: () => 40,
        }),
      { initialProps: { layoutEdges: firstEdges }, wrapper: wrapperFor(store) }
    );
    expect(workers).toHaveLength(1);
    rerender({ layoutEdges: replacementEdges });
    expect(workers).toHaveLength(2);
  });

  it("preserves finite zero-valued force parameters and radii", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore(), {
      linkDistance: 0,
      chargeStrength: 0,
      getNodeRadius: () => 0,
    });
    const payload = workers[0].posted[0] as {
      linkDistance: number;
      chargeStrength: number;
      nodeRadii: { id: string; r: number }[];
    };
    expect(payload.linkDistance).toBe(0);
    expect(payload.chargeStrength).toBe(0);
    expect(payload.nodeRadii.map(({ r }) => r)).toEqual([0, 0]);
  });

  it("marks already-positioned nodes as fixed", () => {
    const workers = stubWorker();
    renderForceLayout(createGraphCanvasStore({ a: { x: 3, y: 4 } }));
    const payload = workers[0].posted[0] as { fixedIds: string[] };
    expect(payload.fixedIds).toEqual(["a"]);
  });

  it("holds a transient phase open while running", () => {
    stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    expect(store.getState().transientDepth).toBe(1);
  });
});

describe("useForceLayout — manual placement wins", () => {
  it("stops moving a node once something else has placed it", () => {
    // Regression: the set of "already positioned" ids was snapshotted when the
    // worker started, so a node that began unpositioned was rewritten on every
    // flush — undoing a drag or keyboard nudge made during the simulation.
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    const tick = (v: number) =>
      act(() => {
        workers[0].emit({ type: "tick", updates: new Float32Array([v, v, v + 1, v + 1]) });
      });

    // Four ticks so the first flush lands.
    tick(1); tick(2); tick(3); tick(4);
    expect(store.getState().positions.a).toEqual({ x: 4, y: 4 });

    // The user drags node "a" somewhere deliberate.
    act(() => { store.getState().setNodePosition("a", 999, 999); });

    tick(5); tick(6); tick(7); tick(8);
    expect(store.getState().positions.a).toEqual({ x: 999, y: 999 });
    // "b" was never touched, so the simulation still owns it.
    expect(store.getState().positions.b).toEqual({ x: 9, y: 9 });
  });
});

describe("useForceLayout — failure fallbacks", () => {
  // Every one of these used to leave the affected nodes with no position at
  // all, which renders as a blank graph rather than a degraded one.
  it("seeds positions when the worker reports an error", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderForceLayout(store);

    act(() => { workers[0].emit({ type: "error", error: "boom" }); });

    expect(store.getState().positions.a).toBeDefined();
    expect(store.getState().positions.b).toBeDefined();
    expect(store.getState().transientDepth).toBe(0);
    expect(workers[0].terminated).toBe(true);
    spy.mockRestore();
  });

  it("seeds positions when the worker fails to load", () => {
    // A worker that throws at top level never posts a message, so `error` is
    // the only signal — and nothing was listening for it.
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderForceLayout(store);

    act(() => { workers[0].emitError("failed to load"); });

    expect(store.getState().positions.a).toBeDefined();
    expect(store.getState().transientDepth).toBe(0);
    spy.mockRestore();
  });

  it("seeds distinct positions rather than stacking everything at the origin", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderForceLayout(store);
    act(() => { workers[0].emitError("nope"); });
    expect(store.getState().positions.a).not.toEqual(store.getState().positions.b);
    spy.mockRestore();
  });

  it("does not seed over a layout that already ended", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    act(() => { workers[0].emit({ type: "tick", updates: new Float32Array([7, 7, 8, 8]) }); });
    act(() => { workers[0].emit({ type: "end" }); });
    const after = store.getState().positions.a;

    act(() => { workers[0].emitError("late failure"); });
    expect(store.getState().positions.a).toEqual(after);
  });
});

describe("useForceLayout — worker messages", () => {
  it("batches ticks, flushing only every 4th one", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    const tick = (v: number) =>
      act(() => {
        workers[0].emit({ type: "tick", updates: new Float32Array([v, v, v, v]) });
      });

    tick(1);
    tick(2);
    tick(3);
    // Nothing committed yet — the layer coalesces to keep redraws down.
    expect(store.getState().positions.a).toBeUndefined();

    tick(4);
    expect(store.getState().positions.a).toEqual({ x: 4, y: 4 });
  });

  it("applies tick coordinates in node order", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    act(() => {
      for (let i = 0; i < 4; i++) {
        workers[0].emit({ type: "tick", updates: new Float32Array([10, 20, 30, 40]) });
      }
    });
    expect(store.getState().positions.a).toEqual({ x: 10, y: 20 });
    expect(store.getState().positions.b).toEqual({ x: 30, y: 40 });
  });

  it("flushes any buffered remainder on end", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    act(() => {
      // A single tick is below the flush interval, so only `end` commits it.
      workers[0].emit({ type: "tick", updates: new Float32Array([7, 8, 9, 10]) });
      workers[0].emit({ type: "end" });
    });
    expect(store.getState().positions.a).toEqual({ x: 7, y: 8 });
  });

  it("seeds only nodes whose completed worker output is non-finite", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    act(() => {
      workers[0].emit({
        type: "tick",
        updates: new Float32Array([Number.NaN, Number.NaN, 9, 10]),
      });
      workers[0].emit({ type: "end" });
    });

    expect(Number.isFinite(store.getState().positions.a.x)).toBe(true);
    expect(Number.isFinite(store.getState().positions.a.y)).toBe(true);
    expect(store.getState().positions.b).toEqual({ x: 9, y: 10 });
    expect(store.getState().transientDepth).toBe(0);
  });

  it("ends the transient phase and terminates on end", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    renderForceLayout(store);
    act(() => {
      workers[0].emit({ type: "tick", updates: new Float32Array([1, 2, 3, 4]) });
      workers[0].emit({ type: "end" });
    });
    expect(store.getState().transientDepth).toBe(0);
    expect(workers[0].terminated).toBe(true);
  });

  it("recovers from a worker error rather than staying transient forever", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderForceLayout(store);
    act(() => { workers[0].emit({ type: "error", error: "boom" }); });
    expect(store.getState().transientDepth).toBe(0);
    expect(workers[0].terminated).toBe(true);
    spy.mockRestore();
  });

  it("terminates and balances the transient on unmount", () => {
    const workers = stubWorker();
    const store = createGraphCanvasStore();
    const hook = renderForceLayout(store);
    hook.unmount();
    expect(workers[0].terminated).toBe(true);
    expect(store.getState().transientDepth).toBe(0);
  });
});

// ─── useGraphLinkBridge ───────────────────────────────────────────────────────

const bridgeArgs = (over: Record<string, unknown> = {}) => ({
  active: true,
  graphId: "A",
  toKey: (id: string) => id,
  nodes,
  selection: [] as string[],
  hoveredNodeId: null as string | null,
  getHandle: () => null,
  getContainer: () => null,
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  getOnExternalDrop: () => undefined,
  ...over,
});

describe("useGraphLinkBridge", () => {
  it("registers the graph with the link", () => {
    const link = createGraphLink();
    renderHook(() => useGraphLinkBridge({ link, ...bridgeArgs() }));
    expect(link.listGraphs()).toEqual(["A"]);
  });

  it("publishes selection and hover as shared keys", () => {
    const link = createGraphLink();
    renderHook(() =>
      useGraphLinkBridge({ link, ...bridgeArgs({ selection: ["a"], hoveredNodeId: "b" }) })
    );
    expect(link.store.getState().sources.A).toEqual({ selectedKeys: ["a"], hoverKey: "b" });
  });

  it("maps ids through toKey", () => {
    const link = createGraphLink();
    renderHook(() =>
      useGraphLinkBridge({
        link,
        ...bridgeArgs({ selection: ["a"], toKey: (id: string) => `k:${id}` }),
      })
    );
    expect(link.store.getState().sources.A.selectedKeys).toEqual(["k:a"]);
  });

  it("derives highlights from other graphs, never its own signals", () => {
    const link = createGraphLink();
    link.store.getState().publish("B", { selectedKeys: ["a"], hoverKey: null });
    const hook = renderHook(() =>
      useGraphLinkBridge({ link, ...bridgeArgs({ selection: ["b"] }) })
    );
    // "a" comes from peer B; "b" is our own selection and must not echo back.
    expect(hook.result.current).toEqual(["a"]);
  });

  it("includes a peer's hovered node", () => {
    const link = createGraphLink();
    link.store.getState().publish("B", { selectedKeys: [], hoverKey: "b" });
    const hook = renderHook(() => useGraphLinkBridge({ link, ...bridgeArgs() }));
    expect(hook.result.current).toEqual(["b"]);
  });

  it("returns nothing when inactive", () => {
    const link = createGraphLink();
    link.store.getState().publish("B", { selectedKeys: ["a"], hoverKey: null });
    const hook = renderHook(() =>
      useGraphLinkBridge({ link, ...bridgeArgs({ active: false }) })
    );
    expect(hook.result.current).toEqual([]);
    expect(link.listGraphs()).toEqual([]);
  });

  it("withdraws its signals on unmount", () => {
    const link = createGraphLink();
    const hook = renderHook(() =>
      useGraphLinkBridge({ link, ...bridgeArgs({ selection: ["a"] }) })
    );
    expect(link.store.getState().sources.A).toBeDefined();
    hook.unmount();
    expect(link.store.getState().sources.A).toBeUndefined();
    expect(link.listGraphs()).toEqual([]);
  });
});
