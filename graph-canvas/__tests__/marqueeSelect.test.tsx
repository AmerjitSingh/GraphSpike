// @vitest-environment jsdom
// NOTE: deliberately does NOT import ./setup.dom — this hook takes its
// containerRef as a parameter, so the test supplies its own element rect.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useMarqueeSelect } from "../hooks/useMarqueeSelect";
import { createGraphCanvasStore } from "../store";
import { SpatialIndex } from "../spatialIndex";
import type { GraphNode, NodePosition } from "../types";

afterEach(() => cleanup());

const nodes: GraphNode<unknown>[] = [
  { id: "a", data: null },
  { id: "b", data: null },
  { id: "far", data: null },
];
const positions: Record<string, NodePosition> = {
  a: { x: 0, y: 0 },
  b: { x: 50, y: 50 },
  far: { x: 5000, y: 5000 },
};

/** A container element whose rect we control (no global stub involved). */
function makeContainer() {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  document.body.appendChild(el);
  return el;
}

function setup(enabled = true, spacePressed = false) {
  const container = makeContainer();
  const store = createGraphCanvasStore(positions);
  const index = new SpatialIndex();
  index.rebuild(nodes, positions, () => 10);

  const hook = renderHook(() =>
    useMarqueeSelect({
      containerRef: { current: container },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      spatialIndex: { current: index },
      spacePressedRef: { current: spacePressed },
      store,
      enabled,
    })
  );
  return { hook, store, container };
}

/** Minimal React-style pointer event object the handlers actually read. */
function evt(over: Record<string, unknown> = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    target: document.createElement("div"),
    ...over,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("useMarqueeSelect — gating", () => {
  it("does nothing when disabled", () => {
    const { hook } = setup(false);
    act(() => hook.result.current.onPointerDown(evt()));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 100 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("ignores non-primary buttons", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ button: 2 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 100 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("ignores a second touch so pinch takeover cannot start another marquee", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
    })));
    act(() => hook.result.current.onPointerMove(evt({
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
      clientX: 100,
      clientY: 100,
    })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("defers to space-bar panning", () => {
    const { hook } = setup(true, true);
    act(() => hook.result.current.onPointerDown(evt()));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 100 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("ignores presses that start on a node", () => {
    const { hook } = setup();
    const node = document.createElement("div");
    node.setAttribute("data-gc-node", "a");
    act(() => hook.result.current.onPointerDown(evt({ target: node })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 100 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("ignores presses that start on canvas chrome", () => {
    const { hook } = setup();
    const chrome = document.createElement("div");
    chrome.setAttribute("data-gc-minimap", "");
    act(() => hook.result.current.onPointerDown(evt({ target: chrome })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 100 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });
});

describe("useMarqueeSelect — rectangle", () => {
  it("does not let another primary pointer replace an in-flight marquee", () => {
    const { hook, store } = setup();
    act(() => hook.result.current.onPointerDown(evt({ pointerId: 1, clientX: 0, clientY: 0 })));
    act(() =>
      hook.result.current.onPointerMove(evt({ pointerId: 1, clientX: 100, clientY: 100 }))
    );
    act(() =>
      hook.result.current.onPointerDown(evt({
        pointerId: 2,
        pointerType: "touch",
        clientX: 300,
        clientY: 300,
      }))
    );
    act(() =>
      hook.result.current.onPointerUp(evt({ pointerId: 2, clientX: 350, clientY: 350 }))
    );
    expect(hook.result.current.marqueeRect).toEqual({ x: 0, y: 0, width: 100, height: 100 });

    act(() =>
      hook.result.current.onPointerUp(evt({ pointerId: 1, clientX: 100, clientY: 100 }))
    );
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });

  it("appears once the drag passes the threshold", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 10, clientY: 10 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 80 })));
    expect(hook.result.current.marqueeRect).toEqual({ x: 10, y: 10, width: 90, height: 70 });
  });

  it("normalises a drag towards the top-left", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 100, clientY: 100 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 40, clientY: 30 })));
    expect(hook.result.current.marqueeRect).toEqual({ x: 40, y: 30, width: 60, height: 70 });
  });

  it("clears on cancel", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 10, clientY: 10 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 80 })));
    act(() => hook.result.current.onPointerCancel());
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("ignores cancellation from a different pointer", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ pointerId: 1, clientX: 10, clientY: 10 })));
    act(() =>
      hook.result.current.onPointerMove(evt({ pointerId: 1, clientX: 100, clientY: 80 }))
    );
    act(() => hook.result.current.onPointerCancel({ pointerId: 2 }));
    expect(hook.result.current.marqueeRect).toEqual({ x: 10, y: 10, width: 90, height: 70 });

    act(() => hook.result.current.onPointerCancel({ pointerId: 1 }));
    expect(hook.result.current.marqueeRect).toBeNull();
  });

  it("drops a stale drag when no button is held (missed pointerup)", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 10, clientY: 10 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 100, clientY: 80, buttons: 0 })));
    expect(hook.result.current.marqueeRect).toBeNull();
    // And a later move must not resurrect it.
    act(() => hook.result.current.onPointerMove(evt({ clientX: 150, clientY: 120 })));
    expect(hook.result.current.marqueeRect).toBeNull();
  });
});

describe("useMarqueeSelect — commit", () => {
  it("selects the nodes inside the swept rectangle", () => {
    const { hook, store } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 0, clientY: 0 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 200, clientY: 200 })));
    act(() => hook.result.current.onPointerUp(evt({ clientX: 200, clientY: 200 })));
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });

  it("commits nothing for a click-sized drag", () => {
    const { hook, store } = setup();
    store.getState().setSelection(["far"]);
    act(() => hook.result.current.onPointerDown(evt({ clientX: 10, clientY: 10 })));
    act(() => hook.result.current.onPointerUp(evt({ clientX: 11, clientY: 11 })));
    expect(store.getState().selectedNodeIds).toEqual(["far"]);
  });

  it("unions with the existing selection when shift is held", () => {
    const { hook, store } = setup();
    store.getState().setSelection(["far"]);
    act(() => hook.result.current.onPointerDown(evt({ clientX: 0, clientY: 0, shiftKey: true })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 200, clientY: 200 })));
    act(() => hook.result.current.onPointerUp(evt({ clientX: 200, clientY: 200 })));
    expect(store.getState().selectedNodeIds.toSorted()).toEqual(["a", "b", "far"]);
  });

  it("flags the follow-up click so it doesn't clear the new selection", () => {
    const { hook } = setup();
    act(() => hook.result.current.onPointerDown(evt({ clientX: 0, clientY: 0 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 200, clientY: 200 })));
    act(() => hook.result.current.onPointerUp(evt({ clientX: 200, clientY: 200 })));
    expect(hook.result.current.justMarqueedRef.current).toBe(true);
    act(() => hook.result.current.onPointerCancel({ pointerId: 2 }));
    expect(hook.result.current.justMarqueedRef.current).toBe(true);
  });

  it("expires click suppression when no compatibility click arrives", () => {
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      act(() => hook.result.current.onPointerDown(evt({ clientX: 0, clientY: 0 })));
      act(() => hook.result.current.onPointerMove(evt({ clientX: 200, clientY: 200 })));
      act(() => hook.result.current.onPointerUp(evt({ clientX: 200, clientY: 200 })));
      expect(hook.result.current.justMarqueedRef.current).toBe(true);
      act(() => { vi.runAllTimers(); });
      expect(hook.result.current.justMarqueedRef.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps through the viewport when panned and zoomed", () => {
    const container = makeContainer();
    const store = createGraphCanvasStore(positions);
    const index = new SpatialIndex();
    index.rebuild(nodes, positions, () => 10);
    const hook = renderHook(() =>
      useMarqueeSelect({
        containerRef: { current: container },
        viewport: { x: 100, y: 100, zoom: 2 },
        nodes,
        spatialIndex: { current: index },
        spacePressedRef: { current: false },
        store,
        enabled: true,
      })
    );
    // Screen (100,100)-(300,300) => graph (0,0)-(100,100) at zoom 2, offset 100.
    act(() => hook.result.current.onPointerDown(evt({ clientX: 100, clientY: 100 })));
    act(() => hook.result.current.onPointerMove(evt({ clientX: 300, clientY: 300 })));
    act(() => hook.result.current.onPointerUp(evt({ clientX: 300, clientY: 300 })));
    expect(store.getState().selectedNodeIds).toEqual(["a", "b"]);
  });
});
