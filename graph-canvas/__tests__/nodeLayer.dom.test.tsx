// @vitest-environment jsdom
import "./setup.dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { NodeLayer } from "../renderers/NodeLayer";
import { useStore } from "zustand";
import { GraphCanvasStoreContext, createGraphCanvasStore } from "../store";
import type { GraphCanvasStore } from "../store";
import type {
  GraphNode,
  NodePosition,
  NodeRenderProps,
  PortBehavior,
  PortDef,
} from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
  { id: "c", data: { label: "C" } },
];
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const basePositions: Record<string, NodePosition> = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 200, y: 0 },
};

type LayerProps = Partial<Parameters<typeof NodeLayer<Data>>[0]>;

/**
 * Mirrors GraphCanvas: the `positions` prop is fed from the store, so it tracks
 * live during a drag. Passing a static object here would make onMoveEnd report
 * the pre-drag coordinates.
 */
function LivePositions({ store, ...props }: { store: GraphCanvasStore } & LayerProps) {
  const positions = useStore(store, (s) => s.positions);
  return (
    <NodeLayer<Data>
      nodes={nodes}
      nodeById={nodeById}
      selectedNodeIds={[]}
      zoom={1}
      {...props}
      positions={props.positions ?? positions}
    />
  );
}

function renderLayer(over: LayerProps = {}, positions = basePositions) {
  const store = createGraphCanvasStore({ ...positions });
  const onNodeMove = vi.fn<(id: string, x: number, y: number) => void>();
  const onNodeClick = vi.fn<(id: string, event: React.MouseEvent) => void>();
  const utils = render(
    <GraphCanvasStoreContext.Provider value={store}>
      <LivePositions store={store} onNodeMove={onNodeMove} onNodeClick={onNodeClick} {...over} />
    </GraphCanvasStoreContext.Provider>
  );
  return { ...utils, store, onNodeMove, onNodeClick };
}

/** A single output port, enough to exercise the port rendering path. */
const getNodePorts = (): PortDef[] => [{ id: "out", type: "main", mode: "output" }];

const connectSpy = () =>
  vi.fn<(
    id: string,
    x: number,
    y: number,
    portId: string | undefined,
    pointerId: number
  ) => void>();

/** A single output port with an explicit behaviour, for the behaviour suite. */
const portsWith = (behavior: PortBehavior) => (): PortDef[] =>
  [{ id: "out", type: "tool", mode: "output", behavior }];

/** The click-to-create endpoint the library renders for menu-capable ports. */
const endpoint = (c: HTMLElement) => c.querySelector("button[data-gc-no-drag]");

/** Parse a CSS pixel length, treating an unset value as 0. */
const px = (v: string) => Number.parseFloat(v || "0");

const nodeEl = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-gc-node="${id}"]`) as HTMLElement;

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1, ...init,
  });
}

/**
 * Press, move by (dx,dy) screen px, release — each in its own act() so React
 * commits between events, as it would across real browser tasks. Batching them
 * would leave the `positions` prop stale when pointerup reads it.
 */
function drag(el: HTMLElement, dx: number, dy: number, release = true) {
  act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
  act(() => { el.dispatchEvent(pointer("pointermove", { clientX: dx, clientY: dy })); });
  if (release) {
    act(() => { el.dispatchEvent(pointer("pointerup", { clientX: dx, clientY: dy, buttons: 0 })); });
    act(() => {
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: dx, clientY: dy })
      );
    });
  }
}

describe("NodeLayer — pointer cancel", () => {
  /** Press and move, then have the pointer cancelled instead of released. */
  function dragThenCancel(el: HTMLElement, dx: number, dy: number) {
    act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
    act(() => { el.dispatchEvent(pointer("pointermove", { clientX: dx, clientY: dy })); });
    act(() => { el.dispatchEvent(pointer("pointercancel", { clientX: dx, clientY: dy, buttons: 0 })); });
  }

  it("restores the pre-drag position instead of committing", () => {
    // Regression: pointercancel was wired straight to the pointerup handler,
    // so a palm rejection or gesture takeover committed the move.
    const { container, store, onNodeMove } = renderLayer();
    dragThenCancel(nodeEl(container, "a"), 40, 30);

    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(onNodeMove).not.toHaveBeenCalled();
    expect(store.getState().transientDepth).toBe(0);
  });

  it("restores every node of a cancelled group drag", () => {
    const { container, store } = renderLayer({ selectedNodeIds: ["a", "b"] });
    act(() => { store.getState().setSelection(["a", "b"]); });
    dragThenCancel(nodeEl(container, "a"), 40, 0);

    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 100, y: 0 });
    expect(store.getState().transientDepth).toBe(0);
  });

  it("does not select on a cancelled press that never moved", () => {
    const { container, onNodeClick, store } = renderLayer();
    const el = nodeEl(container, "a");
    act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
    act(() => { el.dispatchEvent(pointer("pointercancel", { clientX: 0, clientY: 0, buttons: 0 })); });

    expect(onNodeClick).not.toHaveBeenCalled();
    expect(store.getState().selectedNodeIds).toEqual([]);
    expect(store.getState().transientDepth).toBe(0);
  });

  it("exposes an imperative cancel so pinch takeover restores the drag", () => {
    const activeDragCancelRef: {
      current: ((pointerId?: number) => void) | null;
    } = { current: null };
    const { container, store, onNodeMove } = renderLayer({ activeDragCancelRef });
    const el = nodeEl(container, "a");
    act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
    act(() => { el.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 30 })); });
    expect(store.getState().positions.a).toEqual({ x: 40, y: 30 });
    expect(activeDragCancelRef.current).toBeTypeOf("function");

    act(() => { activeDragCancelRef.current?.(2); });
    expect(store.getState().positions.a).toEqual({ x: 40, y: 30 });
    expect(store.getState().transientDepth).toBe(1);

    act(() => { activeDragCancelRef.current?.(); });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(store.getState().transientDepth).toBe(0);
    expect(onNodeMove).not.toHaveBeenCalled();
    expect(activeDragCancelRef.current).toBeNull();
  });

  it("does not let another primary pointer replace an active promoted-node drag", () => {
    const activeDragCancelRef: {
      current: ((pointerId?: number) => void) | null;
    } = { current: null };
    const { container, store, onNodeMove } = renderLayer({ activeDragCancelRef });
    const first = nodeEl(container, "a");
    const second = nodeEl(container, "b");
    act(() => { first.dispatchEvent(pointer("pointerdown", { pointerId: 1 })); });
    act(() => {
      first.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 40, clientY: 0 }));
    });
    act(() => {
      second.dispatchEvent(pointer("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: true,
        clientX: 100,
      }));
      second.dispatchEvent(pointer("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: true,
        clientX: 140,
      }));
      second.dispatchEvent(pointer("pointerup", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: true,
        clientX: 140,
        buttons: 0,
      }));
    });
    expect(store.getState().positions.b).toEqual({ x: 100, y: 0 });
    expect(store.getState().transientDepth).toBe(1);

    act(() => {
      first.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 40, buttons: 0 }));
    });
    expect(onNodeMove).toHaveBeenCalledWith("a", 40, 0);
    expect(store.getState().transientDepth).toBe(0);
  });
});

describe("NodeLayer — rendering", () => {
  it("does not re-render untouched nodes while one is dragged", () => {
    // Regression: `GraphNodeItem` is memoised, but `ports`, `size` and
    // `connectedPortIds` were rebuilt inline per render, so every node got
    // three fresh objects and the memo never held. With `renderAllNodes` that
    // meant the whole graph re-rendered on every drag frame and every
    // simulation tick.
    const seen: string[] = [];
    const renderNode = ({ node }: NodeRenderProps<Data>) => {
      seen.push(node.id);
      return <div>{node.data.label}</div>;
    };
    const { container } = renderLayer({ renderNode, getNodePorts });
    expect(new Set(seen)).toEqual(new Set(["a", "b", "c"]));

    seen.length = 0;
    drag(nodeEl(container, "a"), 40, 0, false);

    // The dragged node must still track the pointer...
    expect(seen).toContain("a");
    // ...while its neighbours, whose positions did not change, sit it out.
    expect(seen).not.toContain("b");
    expect(seen).not.toContain("c");
  });

  it("renders every node by default", () => {
    const { container } = renderLayer();
    expect(container.querySelectorAll("[data-gc-node]")).toHaveLength(3);
  });

  it("renders only the selection when activeOnly is set", () => {
    const { container } = renderLayer({ activeOnly: true, selectedNodeIds: ["b"] });
    const rendered = [...container.querySelectorAll("[data-gc-node]")].map((e) =>
      e.getAttribute("data-gc-node")
    );
    expect(rendered).toEqual(["b"]);
  });

  it("renders activeOnly nodes in selection order", () => {
    const { container } = renderLayer({ activeOnly: true, selectedNodeIds: ["c", "a"] });
    const rendered = [...container.querySelectorAll("[data-gc-node]")].map((e) =>
      e.getAttribute("data-gc-node")
    );
    expect(rendered).toEqual(["c", "a"]);
  });

  it("skips a node that has no position", () => {
    const { container } = renderLayer({ positions: { a: basePositions.a } }, { a: basePositions.a });
    expect(container.querySelectorAll("[data-gc-node]")).toHaveLength(1);
  });

  it("labels a node from its data, falling back to the id", () => {
    const { container } = renderLayer({
      nodes: [{ id: "bare", data: {} as Data }],
      nodeById: new Map([["bare", { id: "bare", data: {} as Data }]]),
      positions: { bare: { x: 0, y: 0 } },
    }, { bare: { x: 0, y: 0 } });
    expect(container.textContent).toContain("bare");
  });

  it("passes isHighlighted through to a custom renderer", () => {
    const seen: boolean[] = [];
    const renderNode = ({ isHighlighted }: NodeRenderProps<Data>) => {
      seen.push(isHighlighted);
      return <span />;
    };
    renderLayer({ renderNode, highlightedNodeIds: ["a"] });
    expect(seen.filter(Boolean)).toHaveLength(1);
  });

  it("only shows ports when connecting is possible", () => {
    const { container: without } = renderLayer({ getNodePorts });
    expect(without.querySelector("[data-gc-handle]")).toBeNull();
    cleanup();
    const { container: with_ } = renderLayer({ getNodePorts, onConnectStart: connectSpy() });
    expect(with_.querySelector("[data-gc-handle]")).toBeTruthy();
  });

  it("renders nothing without a port registry", () => {
    const { container } = renderLayer({ onConnectStart: connectSpy() });
    expect(container.querySelector("[data-gc-handle]")).toBeNull();
  });

  it("hides a port when the renderer returns null", () => {
    const { container } = renderLayer({
      getNodePorts,
      onConnectStart: connectSpy(),
      renderPort: () => null,
    });
    expect(container.querySelector("[data-gc-handle]")).toBeNull();
  });

  it("tags each port element with its id", () => {
    const { container } = renderLayer({ getNodePorts, onConnectStart: connectSpy() });
    const handle = container.querySelector("[data-gc-handle]") as HTMLElement;
    expect(handle.getAttribute("data-gc-port")).toBe("out");
  });
});

describe("NodeLayer — port behaviour", () => {
  it("drag: is a drag source with no endpoint", () => {
    const { container } = renderLayer({
      getNodePorts: portsWith("drag"),
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    expect(container.querySelector("[data-gc-handle]")).toBeTruthy();
    expect(endpoint(container)).toBeNull();
  });

  it("menu: shows the endpoint but is not a drag source", () => {
    const { container } = renderLayer({
      getNodePorts: portsWith("menu"),
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    // No data-gc-handle means the pointerdown path can't start a connection.
    expect(container.querySelector("[data-gc-handle]")).toBeNull();
    expect(endpoint(container)).toBeTruthy();
    // The port itself is still in the DOM, just not draggable.
    expect(container.querySelector("[data-gc-port='out']")).toBeTruthy();
  });

  it("both: is a drag source AND shows the endpoint", () => {
    const { container } = renderLayer({
      getNodePorts: portsWith("both"),
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    expect(container.querySelector("[data-gc-handle]")).toBeTruthy();
    expect(endpoint(container)).toBeTruthy();
  });

  it("defaults to drag when behavior is omitted", () => {
    const { container } = renderLayer({
      getNodePorts,
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    expect(container.querySelector("[data-gc-handle]")).toBeTruthy();
    expect(endpoint(container)).toBeNull();
  });

  it("hides the endpoint when there is no menu for it to open", () => {
    const { container } = renderLayer({
      getNodePorts: portsWith("both"),
      onConnectStart: connectSpy(),
      // no onPortContextMenu — the affordance would be dead
    });
    expect(endpoint(container)).toBeNull();
  });

  it("opens the port menu when the endpoint is clicked", () => {
    const onPortContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderLayer({
      getNodePorts: portsWith("both"),
      onConnectStart: connectSpy(),
      onPortContextMenu,
    });
    act(() => {
      (endpoint(container) as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(onPortContextMenu).toHaveBeenCalledWith(
      "a",
      expect.anything(),
      expect.objectContaining({ id: "out" }),
      { x: 0, y: -40 }
    );
  });

  it("scales port chrome with the canvas rather than compensating for zoom", () => {
    // Everything attached to a port belongs to the node and must scale with it.
    // Counter-scaling holds a fixed screen size, so as you zoom out the chrome
    // grows relative to the node until neighbouring labels overlap.
    const { container } = renderLayer({
      getNodePorts: () => [
        { id: "out", type: "tool", mode: "output", behavior: "both", label: "Tool" },
      ],
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const button = endpoint(container) as HTMLElement;
    const label = container.querySelector("[data-gc-port='out'] span") as HTMLElement;

    for (const el of [label, button]) {
      // No counter-scaling of any kind: no `scale`, and no var() smuggled into
      // a transform or a font size.
      expect(el.style.scale).toBe("");
      expect(el.style.transform).not.toContain("var(");
      expect(el.style.fontSize).not.toContain("var(");
    }
  });

  it("keeps the stub clear of the label instead of drawing through it", () => {
    // mode "input" on a non-main type puts this on the BOTTOM edge, so every
    // outward offset is a marginTop — the same axis the assertions read.
    const { container } = renderLayer({
      getNodePorts: () => [
        { id: "tool", type: "tool", mode: "input", behavior: "both", label: "Tool" },
      ],
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const wrapper = container.querySelector("[data-gc-port='tool']") as HTMLElement;
    const stub = Array.from(wrapper.children).find(
      (el) => (el as HTMLElement).style.borderLeftStyle === "dotted"
    ) as HTMLElement;
    const label = wrapper.querySelector("span") as HTMLElement;
    const button = endpoint(container) as HTMLElement;

    // Outward order must be: label, then stub, then endpoint — with the stub
    // starting past where the label ends.
    expect(px(label.style.marginTop)).toBeLessThan(px(stub.style.marginTop));
    expect(px(stub.style.marginTop) + px(stub.style.height)).toBeLessThanOrEqual(
      px(button.style.marginTop)
    );
  });

  it("draws the stub as a dotted line, not a solid bar", () => {
    const { container } = renderLayer({
      getNodePorts: portsWith("menu"),
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const wrapper = container.querySelector("[data-gc-port='out']") as HTMLElement;
    const stub = Array.from(wrapper.children).find(
      (el) => (el as HTMLElement).style.borderLeftStyle === "dotted"
    ) as HTMLElement | undefined;

    expect(stub).toBeTruthy();
    // Zero-thickness box + border, so the dots render crisply rather than as a
    // filled rectangle.
    expect(stub!.style.width).toBe("0px");
    expect(stub!.style.background).toBe("");
  });

  it("does not start a connection when the endpoint is pressed", () => {
    // The endpoint lives inside the [data-gc-handle] wrapper, so a handle-first
    // pointerdown would begin a connect drag and paint a preview line before
    // the click ever opened the menu.
    const onConnectStart = connectSpy();
    const { container } = renderLayer({
      getNodePorts: portsWith("both"),
      onConnectStart,
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const el = endpoint(container) as HTMLElement;
    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 30, clientY: 30 }));
    });
    expect(onConnectStart).not.toHaveBeenCalled();
  });

  it("still starts a connection from the port glyph itself", () => {
    const onConnectStart = connectSpy();
    const { container } = renderLayer({
      getNodePorts: portsWith("both"),
      onConnectStart,
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const handle = container.querySelector("[data-gc-handle]") as HTMLElement;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    });
    expect(onConnectStart).toHaveBeenCalled();
  });

  it("does not start a node drag when the endpoint is pressed", () => {
    const { container, store } = renderLayer({
      getNodePorts: portsWith("menu"),
      onConnectStart: connectSpy(),
      onPortContextMenu: vi.fn<(id: string) => void>(),
    });
    const el = endpoint(container) as HTMLElement;
    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 }));
    });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });
});

describe("NodeLayer — drag threshold", () => {
  it("treats a sub-threshold press as a click, not a drag", () => {
    const { container, store, onNodeMove, onNodeClick } = renderLayer();
    drag(nodeEl(container, "a"), 2, 0);
    expect(onNodeMove).not.toHaveBeenCalled();
    expect(onNodeClick).toHaveBeenCalledWith("a", expect.anything());
    const event = onNodeClick.mock.calls[0][1] as React.MouseEvent;
    expect(event.type).toBe("click");
    expect(event.nativeEvent).toBeInstanceOf(MouseEvent);
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });

  it("commits a drag past the threshold", () => {
    const { container, store, onNodeMove, onNodeClick } = renderLayer();
    drag(nodeEl(container, "a"), 40, 20);
    expect(store.getState().positions.a).toEqual({ x: 40, y: 20 });
    expect(onNodeMove).toHaveBeenCalledWith("a", 40, 20);
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("measures the threshold in screen pixels, then applies the delta in graph units", () => {
    // At zoom 0.5 a 4px screen move clears the 3px threshold and moves the node
    // 8 graph units — the threshold must not be divided by zoom.
    const { container, store } = renderLayer({ zoom: 0.5 });
    drag(nodeEl(container, "a"), 4, 0);
    expect(store.getState().positions.a).toEqual({ x: 8, y: 0 });
  });

  it("scales the delta down when zoomed in", () => {
    const { container, store } = renderLayer({ zoom: 2 });
    drag(nodeEl(container, "a"), 10, 0);
    expect(store.getState().positions.a).toEqual({ x: 5, y: 0 });
  });

  it("ignores non-primary buttons", () => {
    const { container, store } = renderLayer();
    act(() => {
      const el = nodeEl(container, "a");
      el.dispatchEvent(pointer("pointerdown", { button: 2, clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 }));
    });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });

  it("ignores a non-primary touch so GraphCanvas can promote it to pinch", () => {
    const { container, store } = renderLayer();
    const el = nodeEl(container, "a");
    act(() => {
      el.dispatchEvent(pointer("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
        clientX: 0,
        clientY: 0,
      }));
      el.dispatchEvent(pointer("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
        clientX: 40,
        clientY: 0,
      }));
    });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });

  it("ignores a move that never began with a press", () => {
    const { container, store } = renderLayer();
    act(() => {
      nodeEl(container, "a").dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 }));
    });
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });
});

describe("NodeLayer — selection via click", () => {
  it("selects the pressed node", () => {
    const { container, store } = renderLayer();
    drag(nodeEl(container, "b"), 0, 0);
    expect(store.getState().selectedNodeIds).toEqual(["b"]);
  });

  it("toggles with shift held", () => {
    const { container, store } = renderLayer();
    drag(nodeEl(container, "a"), 0, 0);
    act(() => {
      const el = nodeEl(container, "b");
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0, shiftKey: true }));
      el.dispatchEvent(pointer("pointerup", { clientX: 0, clientY: 0, shiftKey: true, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    });
    expect(store.getState().selectedNodeIds.toSorted()).toEqual(["a", "b"]);
  });
});

describe("NodeLayer — group drag", () => {
  const selected = ["a", "b"];

  it("moves every selected peer by the same delta", () => {
    const { container, store } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    drag(nodeEl(container, "a"), 30, 10);
    expect(store.getState().positions.a).toEqual({ x: 30, y: 10 });
    expect(store.getState().positions.b).toEqual({ x: 130, y: 10 });
    // Unselected nodes stay put.
    expect(store.getState().positions.c).toEqual({ x: 200, y: 0 });
  });

  it("moves a selected peer whose id is a prototype property", () => {
    const unusualNodes: GraphNode<Data>[] = [
      { id: "a", data: { label: "A" } },
      { id: "__proto__", data: { label: "Prototype" } },
    ];
    const unusualPositions = Object.create(null) as Record<string, NodePosition>;
    unusualPositions.a = { x: 0, y: 0 };
    unusualPositions.__proto__ = { x: 100, y: 0 };
    const unusualNodeById = new Map(unusualNodes.map((node) => [node.id, node]));
    const selectedIds = ["a", "__proto__"];
    const { container, store } = renderLayer(
      {
        nodes: unusualNodes,
        nodeById: unusualNodeById,
        selectedNodeIds: selectedIds,
      },
      unusualPositions
    );
    act(() => { store.getState().setSelection(selectedIds); });
    drag(nodeEl(container, "a"), 30, 10);
    expect(store.getState().positions.__proto__).toEqual({ x: 130, y: 10 });
  });

  it("reports onNodeMove for the dragged node and each peer", () => {
    const { container, store, onNodeMove } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    drag(nodeEl(container, "a"), 30, 10);
    expect(onNodeMove).toHaveBeenCalledWith("a", 30, 10);
    expect(onNodeMove).toHaveBeenCalledWith("b", 130, 10);
  });

  it("does not group when the dragged node is not part of the selection", () => {
    const { container, store } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    drag(nodeEl(container, "c"), 30, 0);
    expect(store.getState().positions.c).toEqual({ x: 230, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 100, y: 0 });
  });

  it("does not group for a single-node selection", () => {
    const { container, store } = renderLayer({ selectedNodeIds: ["a"] });
    act(() => { store.getState().setSelection(["a"]); });
    drag(nodeEl(container, "a"), 30, 0);
    expect(store.getState().positions.b).toEqual({ x: 100, y: 0 });
  });

  it("does not resurrect a peer deleted mid-drag", () => {
    const { container, store, onNodeMove } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    const el = nodeEl(container, "a");
    act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
    act(() => { el.dispatchEvent(pointer("pointermove", { clientX: 30, clientY: 0 })); });
    // The consumer deletes peer "b" mid-drag; usePositionSync prunes its
    // position. The next group move must not write it back into the store.
    act(() => { store.getState().pruneToNodes(["a", "c"]); });
    act(() => { el.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 })); });
    expect(store.getState().positions.b).toBeUndefined();
    act(() => { el.dispatchEvent(pointer("pointerup", { clientX: 40, clientY: 0, buttons: 0 })); });
    expect(store.getState().positions.b).toBeUndefined();
    expect(onNodeMove).toHaveBeenCalledWith("a", 40, 0);
    // A deleted node must not be reported moved — the consumer already removed it.
    expect(onNodeMove).not.toHaveBeenCalledWith("b", expect.anything(), expect.anything());
    expect(store.getState().transientDepth).toBe(0);
  });

  it("does not resurrect a deleted peer when the drag is cancelled", () => {
    const { container, store } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    const el = nodeEl(container, "a");
    act(() => { el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 })); });
    act(() => { el.dispatchEvent(pointer("pointermove", { clientX: 30, clientY: 0 })); });
    act(() => { store.getState().pruneToNodes(["a", "c"]); });
    act(() => { el.dispatchEvent(pointer("pointercancel", { clientX: 30, clientY: 0, buttons: 0 })); });
    // The dragged node is restored; the deleted peer stays deleted.
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
    expect(store.getState().positions.b).toBeUndefined();
    expect(store.getState().transientDepth).toBe(0);
  });

  it("keeps peers exact across many moves (no cumulative drift)", () => {
    const { container, store } = renderLayer({ selectedNodeIds: selected });
    act(() => { store.getState().setSelection(selected); });
    const el = nodeEl(container, "a");
    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      for (let i = 1; i <= 10; i++) {
        el.dispatchEvent(pointer("pointermove", { clientX: i * 5, clientY: 0 }));
      }
      el.dispatchEvent(pointer("pointerup", { clientX: 50, clientY: 0, buttons: 0 }));
    });
    expect(store.getState().positions.a).toEqual({ x: 50, y: 0 });
    expect(store.getState().positions.b).toEqual({ x: 150, y: 0 });
  });
});

const depth = (store: GraphCanvasStore) => store.getState().transientDepth;

describe("NodeLayer — transient balance", () => {

  it("returns to zero after a solo drag", () => {
    const { container, store } = renderLayer();
    drag(nodeEl(container, "a"), 40, 0);
    expect(depth(store)).toBe(0);
  });

  it("returns to zero after a group drag", () => {
    const { container, store } = renderLayer({ selectedNodeIds: ["a", "b"] });
    act(() => { store.getState().setSelection(["a", "b"]); });
    drag(nodeEl(container, "a"), 40, 0);
    expect(depth(store)).toBe(0);
  });

  it("is held open while a drag is in flight", () => {
    const { container, store } = renderLayer();
    drag(nodeEl(container, "a"), 40, 0, /* release */ false);
    expect(depth(store)).toBe(1);
  });

  it("returns to zero when the node unmounts mid-drag", () => {
    // Regression: an unmount during a drag used to leak the transient, which
    // silenced onPositionsChange for the rest of the canvas's life.
    const store = createGraphCanvasStore({ ...basePositions });
    const { container, rerender } = render(
      <GraphCanvasStoreContext.Provider value={store}>
        <NodeLayer<Data>
          nodes={nodes} nodeById={nodeById} positions={basePositions}
          selectedNodeIds={[]} zoom={1}
        />
      </GraphCanvasStoreContext.Provider>
    );
    drag(nodeEl(container, "a"), 40, 0, /* release */ false);
    expect(store.getState().transientDepth).toBe(1);

    // The consumer removes the node while the drag is still live.
    const remaining = nodes.filter((n) => n.id !== "a");
    rerender(
      <GraphCanvasStoreContext.Provider value={store}>
        <NodeLayer<Data>
          nodes={remaining} nodeById={new Map(remaining.map((n) => [n.id, n]))}
          positions={basePositions} selectedNodeIds={[]} zoom={1}
        />
      </GraphCanvasStoreContext.Provider>
    );
    expect(store.getState().transientDepth).toBe(0);
  });

  it("does not fire onMoveEnd when an untouched node unmounts", () => {
    const onNodeMove = vi.fn<(id: string, x: number, y: number) => void>();
    const store = createGraphCanvasStore({ ...basePositions });
    const { rerender } = render(
      <GraphCanvasStoreContext.Provider value={store}>
        <NodeLayer<Data>
          nodes={nodes} nodeById={nodeById} positions={basePositions}
          selectedNodeIds={[]} zoom={1} onNodeMove={onNodeMove}
        />
      </GraphCanvasStoreContext.Provider>
    );
    const remaining = nodes.filter((n) => n.id !== "a");
    rerender(
      <GraphCanvasStoreContext.Provider value={store}>
        <NodeLayer<Data>
          nodes={remaining} nodeById={new Map(remaining.map((n) => [n.id, n]))}
          positions={basePositions} selectedNodeIds={[]} zoom={1} onNodeMove={onNodeMove}
        />
      </GraphCanvasStoreContext.Provider>
    );
    expect(onNodeMove).not.toHaveBeenCalled();
  });
});

const renderNodeWithControls = ({ node }: NodeRenderProps<Data>) => (
  <div>
    <input data-testid={`input-${node.id}`} />
    <button data-testid={`button-${node.id}`}>go</button>
    <span data-testid={`plain-${node.id}`}>{node.data.label}</span>
    <div data-gc-no-drag data-testid={`optout-${node.id}`}>custom</div>
  </div>
);

describe("NodeLayer — interactive content", () => {
  const pressOn = (container: HTMLElement, testid: string) => {
    const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
    const ev = pointer("pointerdown", { clientX: 0, clientY: 0 });
    act(() => { el.dispatchEvent(ev); });
    return ev;
  };

  it("leaves form controls and links usable", () => {
    const { container, onNodeClick, store } = renderLayer({ renderNode: renderNodeWithControls });
    expect(pressOn(container, "input-a").defaultPrevented).toBe(false);
    expect(pressOn(container, "button-a").defaultPrevented).toBe(false);
    const button = container.querySelector('[data-testid="button-a"]') as HTMLElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(store.getState().selectedNodeIds).toEqual([]);
  });

  it("honours an explicit data-gc-no-drag opt-out", () => {
    const { container } = renderLayer({ renderNode: renderNodeWithControls });
    expect(pressOn(container, "optout-a").defaultPrevented).toBe(false);
  });

  it("still drags from ordinary content", () => {
    const { container } = renderLayer({ renderNode: renderNodeWithControls });
    expect(pressOn(container, "plain-a").defaultPrevented).toBe(true);
  });

  it("leaves a port to the connect handler instead of dragging the node", () => {
    const onConnectStart = connectSpy();
    const { container, store } = renderLayer({ getNodePorts, onConnectStart });
    const handle = container.querySelector("[data-gc-handle]") as HTMLElement;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      handle.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 0 }));
    });
    // The port id must reach the drag hook — that's what makes sourcePort work.
    expect(onConnectStart).toHaveBeenCalledWith(
      "a",
      expect.any(Number),
      expect.any(Number),
      "out",
      1
    );
    // The node itself must not have moved.
    expect(store.getState().positions.a).toEqual({ x: 0, y: 0 });
  });
});

describe("NodeLayer — other callbacks", () => {
  it("reports double clicks", () => {
    const onNodeDoubleClick = vi.fn<(id: string) => void>();
    const { container } = renderLayer({ onNodeDoubleClick });
    act(() => {
      nodeEl(container, "a").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true })
      );
    });
    expect(onNodeDoubleClick).toHaveBeenCalledWith("a", expect.anything());
  });

  it("reports a node context menu and suppresses the browser's", () => {
    const onNodeContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderLayer({ onNodeContextMenu });
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { nodeEl(container, "a").dispatchEvent(ev); });
    expect(onNodeContextMenu).toHaveBeenCalledWith("a", expect.anything());
    expect(ev.defaultPrevented).toBe(true);
  });

  it("leaves the context menu alone when no handler is supplied", () => {
    const { container } = renderLayer();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { nodeEl(container, "a").dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("keeps the native context menu for interactive node content", () => {
    const onNodeContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderLayer({ renderNode: renderNodeWithControls, onNodeContextMenu });
    const input = container.querySelector('[data-testid="input-a"]') as HTMLElement;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(ev); });
    expect(onNodeContextMenu).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("reports a port context menu carrying the port", () => {
    const onPortContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderLayer({
      getNodePorts,
      onConnectStart: connectSpy(),
      onPortContextMenu,
    });
    const handle = container.querySelector("[data-gc-handle]") as HTMLElement;
    act(() => {
      handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(onPortContextMenu).toHaveBeenCalledWith(
      "a",
      expect.anything(),
      expect.objectContaining({ id: "out" })
    );
  });

  it("does not suppress a port context menu when no managed handler exists", () => {
    const { container } = renderLayer({ getNodePorts, onConnectStart: connectSpy() });
    const handle = container.querySelector("[data-gc-handle]") as HTMLElement;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { handle.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });

  it("keeps the native menu for interactive content rendered inside a port", () => {
    const onPortContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderLayer({
      getNodePorts,
      onConnectStart: connectSpy(),
      onPortContextMenu,
      renderPort: () => <button type="button" data-testid="port-control">port action</button>,
    });
    const control = container.querySelector('[data-testid="port-control"]') as HTMLElement;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { control.dispatchEvent(ev); });
    expect(onPortContextMenu).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});
