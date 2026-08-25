// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useContextMenu } from "../hooks/useContextMenu";
import type { GraphEdge, GraphNode, NodePosition, Viewport } from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodeA: GraphNode<Data> = { id: "a", data: { label: "A" } };
const nodeB: GraphNode<Data> = { id: "b", data: { label: "B" } };
const edge: GraphEdge<unknown> = { id: "e1", source: "a", target: "b", data: null };

const nodeById = new Map([["a", nodeA], ["b", nodeB]]);
const edgeById = new Map([["e1", edge]]);
const nodePositions: Record<string, NodePosition> = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

function makeContainer() {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 20, top: 10, right: 820, bottom: 610, width: 800, height: 600, toJSON() {} });
  document.body.appendChild(el);
  return el;
}

function setup(
  viewport: Viewport = { x: 0, y: 0, zoom: 1 },
  withRenderer = true,
  withPorts = false
) {
  const container = makeContainer();
  const renderContextMenu = withRenderer ? vi.fn<() => null>(() => null) : undefined;
  const hook = renderHook(() =>
    useContextMenu<Data, unknown>({
      containerRef: { current: container },
      viewport,
      renderContextMenu,
      nodeById,
      edgeById,
      nodePositions,
      getNodePorts: withPorts
        ? () => [{ id: "out", type: "main", mode: "output" as const }]
        : undefined,
    })
  );
  return { hook, container };
}

/** Minimal React-style mouse event. */
function mouse(clientX = 120, clientY = 60) {
  return {
    clientX,
    clientY,
    target: document.createElement("div"),
    preventDefault: vi.fn<() => void>(),
    stopPropagation: vi.fn<() => void>(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

describe("useContextMenu — opening", () => {
  it("starts closed", () => {
    const { hook } = setup();
    expect(hook.result.current.contextMenu).toBeNull();
  });

  it("opens a canvas menu and maps all three coordinate spaces", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleCanvasContextMenu(mouse(120, 60)));
    const menu = hook.result.current.contextMenu!;
    expect(menu.target).toEqual({ kind: "canvas" });
    expect(menu.clientPosition).toEqual({ x: 120, y: 60 });
    // container rect is offset by (20,10)
    expect(menu.containerPosition).toEqual({ x: 100, y: 50 });
    expect(menu.graphPosition).toEqual({ x: 100, y: 50 });
  });

  it("accounts for pan and zoom in the graph position", () => {
    const { hook } = setup({ x: 50, y: 20, zoom: 2 });
    act(() => hook.result.current.handleCanvasContextMenu(mouse(120, 60)));
    const menu = hook.result.current.contextMenu!;
    // ((120-20)-50)/2 = 25 ; ((60-10)-20)/2 = 15
    expect(menu.graphPosition).toEqual({ x: 25, y: 15 });
  });

  it("opens a node menu carrying the node and its position", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleNodeContextMenu("a", mouse()));
    const target = hook.result.current.contextMenu!.target;
    expect(target).toEqual({ kind: "node", node: nodeA, position: nodePositions.a });
  });

  it("opens a port menu", () => {
    const { hook } = setup();
    act(() => hook.result.current.handlePortContextMenu("b", mouse()));
    expect(hook.result.current.contextMenu!.target.kind).toBe("port");
  });

  it("carries the port definition when one is supplied", () => {
    const { hook } = setup();
    const port = { id: "out", type: "main", mode: "output" as const };
    act(() => hook.result.current.handlePortContextMenu("b", mouse(), port));
    const target = hook.result.current.contextMenu!.target;
    expect(target).toMatchObject({ kind: "port", port });
  });

  it("anchors a keyboard-opened port menu to the supplied graph geometry", () => {
    const { hook } = setup({ x: 50, y: 20, zoom: 2 }, true, true);
    const port = { id: "out", type: "main", mode: "output" as const };
    act(() =>
      hook.result.current.handlePortContextMenu(
        "a",
        mouse(0, 0),
        port,
        { x: 40, y: 0 }
      )
    );
    const menu = hook.result.current.contextMenu!;
    expect(menu.target).toMatchObject({ kind: "port", port, portPosition: { x: 40, y: 0 } });
    expect(menu.graphPosition).toEqual({ x: 40, y: 0 });
    expect(menu.containerPosition).toEqual({ x: 130, y: 20 });
    expect(menu.clientPosition).toEqual({ x: 150, y: 30 });
  });

  it("opens an edge menu carrying both endpoints", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleEdgeContextMenu("e1", mouse()));
    const target = hook.result.current.contextMenu!.target;
    expect(target).toEqual({ kind: "edge", edge, sourceNode: nodeA, targetNode: nodeB });
  });

  it("can anchor a keyboard-opened node menu to graph geometry", () => {
    const { hook } = setup({ x: 50, y: 20, zoom: 2 });
    act(() => hook.result.current.openNodeContextMenuAt("a", { x: 10, y: 15 }));
    const menu = hook.result.current.contextMenu!;
    expect(menu.target.kind).toBe("node");
    expect(menu.graphPosition).toEqual({ x: 10, y: 15 });
    expect(menu.containerPosition).toEqual({ x: 70, y: 50 });
    // Container rect starts at (20, 10).
    expect(menu.clientPosition).toEqual({ x: 90, y: 60 });
  });

  it("can anchor a keyboard-opened edge menu to its rendered route", () => {
    const { hook } = setup();
    act(() => hook.result.current.openEdgeContextMenuAt("e1", { x: 50, y: 25 }));
    const menu = hook.result.current.contextMenu!;
    expect(menu.target.kind).toBe("edge");
    expect(menu.graphPosition).toEqual({ x: 50, y: 25 });
  });

  it("ignores unknown ids", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleNodeContextMenu("ghost", mouse()));
    act(() => hook.result.current.handleEdgeContextMenu("ghost", mouse()));
    expect(hook.result.current.contextMenu).toBeNull();
  });

  it("does nothing when the consumer renders no menu", () => {
    const { hook } = setup({ x: 0, y: 0, zoom: 1 }, false);
    act(() => hook.result.current.handleCanvasContextMenu(mouse()));
    expect(hook.result.current.contextMenu).toBeNull();
  });
});

describe("useContextMenu — dismissal", () => {
  const open = (hook: ReturnType<typeof setup>["hook"]) =>
    act(() => hook.result.current.handleCanvasContextMenu(mouse()));

  it("closes via closeContextMenu", () => {
    const { hook } = setup();
    open(hook);
    act(() => hook.result.current.closeContextMenu());
    expect(hook.result.current.contextMenu).toBeNull();
  });

  it("closes on an outside pointerdown", () => {
    const { hook } = setup();
    open(hook);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(hook.result.current.contextMenu).toBeNull();
  });

  it("closes on Escape", () => {
    const { hook } = setup();
    open(hook);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(hook.result.current.contextMenu).toBeNull();
  });

  it("closes on resize and on scroll", () => {
    for (const type of ["resize", "scroll"] as const) {
      const { hook } = setup();
      open(hook);
      act(() => { window.dispatchEvent(new Event(type)); });
      expect(hook.result.current.contextMenu).toBeNull();
      cleanup();
    }
  });

  it("does not close on a scroll that originates inside the menu", () => {
    const { hook } = setup();
    open(hook);
    // A scrollable region inside the rendered menu — scrolling it reaches the
    // window's capture-phase listener, but must not dismiss the menu itself.
    const menuEl = document.createElement("div");
    const list = document.createElement("div");
    menuEl.appendChild(list);
    document.body.appendChild(menuEl);
    hook.result.current.contextMenuRef.current = menuEl;
    act(() => { list.dispatchEvent(new Event("scroll")); });
    expect(hook.result.current.contextMenu).not.toBeNull();
    menuEl.remove();
  });

  it("ignores a key that is not Escape", () => {
    const { hook } = setup();
    open(hook);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(hook.result.current.contextMenu).not.toBeNull();
  });
});
