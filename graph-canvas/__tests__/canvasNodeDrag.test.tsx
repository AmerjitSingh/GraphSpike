// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { zoomIdentity } from "d3-zoom";
import { useCanvasNodeDrag } from "../hooks/useCanvasNodeDrag";
import { createGraphCanvasStore } from "../store";
import { SpatialIndex } from "../spatialIndex";
import type { GraphNode, NodePosition } from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];
const positions: Record<string, NodePosition> = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };

function setup(over: {
  enabled?: boolean;
  snapToGrid?: number;
  spacePressed?: boolean;
  nodes?: GraphNode<Data>[];
  positions?: Record<string, NodePosition>;
} = {}) {
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  const captured: number[] = [];
  container.setPointerCapture = (id: number) => { captured.push(id); };
  container.releasePointerCapture = () => {};
  document.body.appendChild(container);

  const graphNodes = over.nodes ?? nodes;
  const graphPositions = over.positions ?? positions;
  const store = createGraphCanvasStore(graphPositions);
  const index = new SpatialIndex<Data>();
  index.rebuild(graphNodes, graphPositions, () => 20);
  const onNodeMove = vi.fn<(id: string, x: number, y: number) => void>();

  const hook = renderHook(() =>
    useCanvasNodeDrag<Data>({
      containerRef: { current: container },
      store,
      spatialIndex: { current: index },
      viewport: { x: 0, y: 0, zoom: 1 },
      spacePressedRef: { current: over.spacePressed ?? false },
      enabled: over.enabled ?? true,
      snapToGrid: over.snapToGrid,
      onNodeMove,
    })
  );
  return { hook, store, onNodeMove, container, captured };
}

function evt(over: Record<string, unknown> = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    clientX: 0,
    clientY: 0,
    target: document.body,
    ...over,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

/** Press, move past the threshold, release. */
function drag(hook: ReturnType<typeof setup>["hook"], to: { x: number; y: number }, from = { x: 0, y: 0 }) {
  act(() => { hook.result.current.onPointerDown(evt({ clientX: from.x, clientY: from.y })); });
  act(() => { hook.result.current.onPointerMove(evt({ clientX: to.x, clientY: to.y })); });
  act(() => { hook.result.current.onPointerUp(evt({ clientX: to.x, clientY: to.y })); });
}

describe("useCanvasNodeDrag — claiming the press", () => {
  it("claims a press that lands on a canvas node", () => {
    const { hook } = setup();
    let claimed = false;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ clientX: 0, clientY: 0 })); });
    expect(claimed).toBe(true);
  });

  it("uses D3's live transform while the React viewport is still RAF-lagging", () => {
    const { hook, container, store } = setup();
    Object.assign(container, { __zoom: zoomIdentity.translate(100, 50).scale(2) });

    let claimed = false;
    act(() => {
      claimed = hook.result.current.onPointerDown(evt({ clientX: 100, clientY: 50 }));
    });
    expect(claimed).toBe(true);

    act(() => {
      hook.result.current.onPointerMove(evt({ clientX: 120, clientY: 50 }));
    });
    expect(store.getState().positions.a).toEqual({ x: 10, y: 0 });
  });

  it("leaves a press on blank canvas for the marquee", () => {
    const { hook } = setup();
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ clientX: 600, clientY: 400 })); });
    expect(claimed).toBe(false);
  });

  it("declines a press on an already-promoted DOM node", () => {
    // NodeLayer owns those; claiming here would drag the node twice.
    const el = document.createElement("div");
    el.setAttribute("data-gc-node", "a");
    document.body.appendChild(el);
    const { hook } = setup();
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ target: el })); });
    expect(claimed).toBe(false);
  });

  it("declines while space is held, so pan mode still pans", () => {
    const { hook } = setup({ spacePressed: true });
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt()); });
    expect(claimed).toBe(false);
  });

  it("declines when disabled (panOnDrag)", () => {
    const { hook } = setup({ enabled: false });
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt()); });
    expect(claimed).toBe(false);
  });

  it("declines a non-left button", () => {
    const { hook } = setup();
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ button: 2 })); });
    expect(claimed).toBe(false);
  });

  it("declines the second touch so pinch takeover cannot replace the active drag", () => {
    const { hook } = setup();
    let claimed = true;
    act(() => {
      claimed = hook.result.current.onPointerDown(evt({
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
      }));
    });
    expect(claimed).toBe(false);
  });
});

describe("useCanvasNodeDrag — must not swallow marquee gestures", () => {
  it("declines a press in the gap between nodes", () => {
    // (100,0) is midway between a(0,0) and b(200,0) and inside neither.
    const { hook } = setup();
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ clientX: 100, clientY: 0 })); });
    expect(claimed).toBe(false);
  });

  it("declines a near-miss rather than snapping to the node", () => {
    // Node a has radius 20, so (35,0) is outside it. A click would still
    // select it (clicks are forgiving); a drag must not claim it.
    const { hook } = setup();
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ clientX: 35, clientY: 0 })); });
    expect(claimed).toBe(false);
  });

  it("does not widen its grab radius as the graph zooms out", () => {
    // Regression (Large Graph demo): the press hit-test used the click
    // tolerance in *graph* units, so at low zoom it grew to hundreds of units
    // and claimed nearly every press — making marquee selection impossible on
    // a dense graph.
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
    container.setPointerCapture = () => {};
    document.body.appendChild(container);
    const index = new SpatialIndex<Data>();
    index.rebuild(nodes, positions, () => 20);

    const hook = renderHook(() =>
      useCanvasNodeDrag<Data>({
        containerRef: { current: container },
        store: createGraphCanvasStore(positions),
        spatialIndex: { current: index },
        viewport: { x: 0, y: 0, zoom: 0.05 },
        spacePressedRef: { current: false },
        enabled: true,
        onNodeMove: undefined,
      })
    );

    // Screen (5,0) -> graph (100,0): the gap between the two nodes.
    let claimed = true;
    act(() => { claimed = hook.result.current.onPointerDown(evt({ clientX: 5, clientY: 0 })); });
    expect(claimed).toBe(false);
  });
});

describe("useCanvasNodeDrag — moving", () => {
  it("moves an unselected node, which is the whole point", () => {
    const { hook, store } = setup();
    expect(store.getState().selectedNodeIds).toEqual([]);
    drag(hook, { x: 50, y: 30 });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 30 });
  });

  it("ignores movement below the drag threshold", () => {
    const { hook, store, onNodeMove } = setup();
    drag(hook, { x: 2, y: 0 });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(onNodeMove).not.toHaveBeenCalled();
  });

  it("captures the pointer only once the press becomes a drag", () => {
    const { hook, captured } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    expect(captured).toEqual([]);
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 0 })); });
    expect(captured).toEqual([1]);
  });

  it("snaps the resolved position to the grid", () => {
    const { hook, store } = setup({ snapToGrid: 20 });
    drag(hook, { x: 53, y: 31 });
    expect(store.getState().positions.a).toEqual({ x: 60, y: 40 });
  });

  it("drags the whole selection when the pressed node is part of it", () => {
    const { hook, store } = setup();
    act(() => { store.getState().setSelection(["a", "b"]); });
    drag(hook, { x: 50, y: 0 });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 250, y: 0 });
  });

  it("drags a selected peer whose id is a prototype property", () => {
    const unusualNodes: GraphNode<Data>[] = [
      { id: "a", data: { label: "A" } },
      { id: "__proto__", data: { label: "Prototype" } },
    ];
    const unusualPositions = Object.create(null) as Record<string, NodePosition>;
    unusualPositions.a = { x: 0, y: 0 };
    unusualPositions.__proto__ = { x: 200, y: 0 };
    const { hook, store } = setup({ nodes: unusualNodes, positions: unusualPositions });
    act(() => { store.getState().setSelection(["a", "__proto__"]); });
    drag(hook, { x: 50, y: 0 });
    expect(store.getState().positions.__proto__).toEqual({ x: 250, y: 0 });
  });

  it("moves only the pressed node when it is outside the selection", () => {
    const { hook, store } = setup();
    act(() => { store.getState().setSelection(["b"]); });
    drag(hook, { x: 50, y: 0 });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 200, y: 0 });
  });

  it("does not change the selection on press", () => {
    // Selection is the click handler's job; pressing to drag must not steal it.
    const { hook, store } = setup();
    drag(hook, { x: 50, y: 0 });
    expect(store.getState().selectedNodeIds).toEqual([]);
  });
});

/** Delete node "a" the way GraphCanvas does when the consumer removes it. */
const removeA = (store: ReturnType<typeof setup>["store"]) =>
  act(() => { store.getState().pruneToNodes(["b"]); });

describe("useCanvasNodeDrag — node removed mid-drag", () => {
  it("does not resurrect a node deleted mid-drag", () => {
    const { hook, store, onNodeMove } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 0 })); });
    removeA(store);

    act(() => { hook.result.current.onPointerMove(evt({ clientX: 80, clientY: 0 })); });
    act(() => { hook.result.current.onPointerUp(evt({ clientX: 80, clientY: 0 })); });

    expect(store.getState().positions.a).toBeUndefined();
    expect(onNodeMove).not.toHaveBeenCalledWith("a", expect.anything(), expect.anything());
    expect(store.getState().transientDepth).toBe(0);
  });

  it("does not resurrect it on cancel either", () => {
    const { hook, store } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 0 })); });
    removeA(store);
    act(() => { hook.result.current.onPointerCancel(); });

    expect(store.getState().positions.a).toBeUndefined();
    expect(store.getState().transientDepth).toBe(0);
  });

  it("finishes a drag whose pointerup was missed", () => {
    // A move with no button held means the release was swallowed. The node has
    // already moved, so the drag must be committed, not silently dropped —
    // otherwise the consumer is never told the node ended up somewhere new.
    const { hook, store, onNodeMove } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 0 })); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 90, clientY: 0, buttons: 0 })); });

    expect(onNodeMove).toHaveBeenCalledWith("a", 50, 0);
    expect(store.getState().transientDepth).toBe(0);
    // No click follows a release the browser never delivered, so the
    // suppression flag must stay down or it eats the next unrelated click.
    expect(hook.result.current.justDraggedRef.current).toBe(false);

    // A later move must not resume the finished drag.
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 300, clientY: 0 })); });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 0 });
  });
});

describe("useCanvasNodeDrag — commit and cancel", () => {
  it("does not let another primary pointer replace an in-flight drag", () => {
    const { hook, store, onNodeMove } = setup();
    act(() => { hook.result.current.onPointerDown(evt({ pointerId: 1 })); });
    act(() => {
      hook.result.current.onPointerMove(evt({ pointerId: 1, clientX: 50, clientY: 0 }));
    });
    let secondClaimed = true;
    act(() => {
      secondClaimed = hook.result.current.onPointerDown(
        evt({ pointerId: 2, pointerType: "touch", clientX: 200, clientY: 0 })
      );
    });
    expect(secondClaimed).toBe(false);
    act(() => { hook.result.current.onPointerUp(evt({ pointerId: 2, buttons: 0 })); });
    expect(store.getState().transientDepth).toBe(1);

    act(() => {
      hook.result.current.onPointerUp(evt({ pointerId: 1, clientX: 50, buttons: 0 }));
    });
    expect(onNodeMove).toHaveBeenCalledWith("a", 50, 0);
    expect(store.getState().transientDepth).toBe(0);
  });

  it("reports every moved node and balances the transient", () => {
    const { hook, store, onNodeMove } = setup();
    act(() => { store.getState().setSelection(["a", "b"]); });
    drag(hook, { x: 50, y: 0 });
    expect(onNodeMove).toHaveBeenCalledWith("a", 50, 0);
    expect(onNodeMove).toHaveBeenCalledWith("b", 250, 0);
    expect(store.getState().transientDepth).toBe(0);
  });

  it("flags the drag so the click that follows is ignored", () => {
    const { hook } = setup();
    drag(hook, { x: 50, y: 0 });
    expect(hook.result.current.justDraggedRef.current).toBe(true);
  });

  it("expires click suppression when no compatibility click arrives", () => {
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      drag(hook, { x: 50, y: 0 });
      expect(hook.result.current.justDraggedRef.current).toBe(true);
      act(() => { vi.runAllTimers(); });
      expect(hook.result.current.justDraggedRef.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not flag a press that never moved", () => {
    const { hook } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerUp(evt()); });
    expect(hook.result.current.justDraggedRef.current).toBe(false);
  });

  it("restores positions on pointercancel and reports no move", () => {
    // A cancelled pointer is an abandoned drag, not a completed one.
    const { hook, store, onNodeMove } = setup();
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 30 })); });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 30 });

    act(() => { hook.result.current.onPointerCancel(); });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(onNodeMove).not.toHaveBeenCalled();
    expect(store.getState().transientDepth).toBe(0);
  });

  it("ignores cancellation from a different pointer", () => {
    const { hook, store } = setup();
    act(() => { hook.result.current.onPointerDown(evt({ pointerId: 1 })); });
    act(() => {
      hook.result.current.onPointerMove(evt({ pointerId: 1, clientX: 50, clientY: 30 }));
    });
    act(() => { hook.result.current.onPointerCancel({ pointerId: 2 }); });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 30 });
    expect(store.getState().transientDepth).toBe(1);

    act(() => { hook.result.current.onPointerCancel({ pointerId: 1 }); });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(store.getState().transientDepth).toBe(0);
  });

  it("restores every node of a cancelled group drag", () => {
    const { hook, store } = setup();
    act(() => { store.getState().setSelection(["a", "b"]); });
    act(() => { hook.result.current.onPointerDown(evt()); });
    act(() => { hook.result.current.onPointerMove(evt({ clientX: 50, clientY: 0 })); });
    act(() => { hook.result.current.onPointerCancel(); });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 200, y: 0 });
  });
});
