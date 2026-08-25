// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useKeyboardNav } from "../hooks/useKeyboardNav";
import { createGraphCanvasStore } from "../store";
import { createConnectionValidator } from "../validation";
import type {
  Connection,
  ConnectionContext,
  GraphEdge,
  GraphNode,
  NodePosition,
  PortDef,
} from "../types";

afterEach(() => cleanup());

//   up
//   |
// left--centre--right
//   |
//  down
const nodes: GraphNode<unknown>[] = ["centre", "right", "left", "up", "down"].map((id) => ({
  id,
  data: null,
}));
const positions: Record<string, NodePosition> = {
  centre: { x: 0, y: 0 },
  right: { x: 200, y: 0 },
  left: { x: -200, y: 0 },
  up: { x: 0, y: -200 },
  down: { x: 0, y: 200 },
};

function setup(over: {
  enabled?: boolean;
  onConnect?: (c: Connection) => void;
  getNodePorts?: (n: GraphNode<unknown>) => PortDef[];
  edges?: GraphEdge<unknown>[];
  edgeIds?: string[];
  onEdgeActivate?: (id: string) => void;
  isValidConnection?: (c: ConnectionContext<unknown>) => boolean;
  validated?: boolean;
} = {}) {
  const store = createGraphCanvasStore(positions);
  const panToNode = vi.fn<(id: string) => void>();
  const onNodeMove = vi.fn<(id: string, x: number, y: number) => void>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Only wire the validator when a test asks for it, so the unvalidated
  // default path stays covered too.
  const validateConnection =
    over.validated || over.getNodePorts || over.edges || over.isValidConnection
      ? createConnectionValidator<unknown, unknown>({
        nodeById,
        getNodePorts: over.getNodePorts,
        edges: over.edges,
        isValidConnection: over.isValidConnection,
      })
      : undefined;
  const hook = renderHook(() =>
    useKeyboardNav({
      nodes,
      positions,
      store,
      panToNode,
      onNodeMove,
      onConnect: over.onConnect,
      enabled: over.enabled ?? true,
      getNodePorts: over.getNodePorts,
      validateConnection,
      edgeIds: over.edgeIds,
      onEdgeActivate: over.onEdgeActivate,
    })
  );
  return { hook, store, panToNode, onNodeMove };
}

/** Minimal React-style keyboard event. */
function key(
  k: string,
  mods: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>> = {}
) {
  return {
    key: k,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn<() => void>(),
    ...mods,
  } as unknown as React.KeyboardEvent;
}

const press = (hook: ReturnType<typeof setup>["hook"], k: string, mods = {}) =>
  act(() => hook.result.current.onKeyDown(key(k, mods)));

describe("useKeyboardNav — focus traversal", () => {
  it("focuses the first node when an arrow is pressed with no focus", () => {
    const { hook } = setup();
    press(hook, "ArrowRight");
    expect(hook.result.current.focusedId).toBe("centre");
  });

  it("moves focus in the pressed direction", () => {
    const { hook } = setup();
    press(hook, "ArrowRight"); // focus centre
    press(hook, "ArrowRight");
    expect(hook.result.current.focusedId).toBe("right");
  });

  it("traverses in each compass direction from the centre", () => {
    for (const [k, expected] of [
      ["ArrowLeft", "left"],
      ["ArrowUp", "up"],
      ["ArrowDown", "down"],
    ] as const) {
      const { hook } = setup();
      press(hook, "ArrowRight"); // focus centre first
      press(hook, k);
      expect(hook.result.current.focusedId).toBe(expected);
      cleanup();
    }
  });

  it("stays put when there is no node in that direction", () => {
    const { hook } = setup();
    press(hook, "ArrowRight"); // centre
    press(hook, "ArrowRight"); // right
    press(hook, "ArrowRight"); // nothing further right
    expect(hook.result.current.focusedId).toBe("right");
  });

  it("reveals the focused node", () => {
    const { hook, panToNode } = setup();
    press(hook, "ArrowRight");
    expect(panToNode).toHaveBeenCalledWith("centre");
  });

  it("jumps to the first and last node with Home/End", () => {
    const { hook } = setup();
    press(hook, "End");
    expect(hook.result.current.focusedId).toBe("down");
    press(hook, "Home");
    expect(hook.result.current.focusedId).toBe("centre");
  });

  it("does nothing at all when disabled", () => {
    const { hook } = setup({ enabled: false });
    press(hook, "ArrowRight");
    expect(hook.result.current.focusedId).toBeNull();
  });
});

describe("useKeyboardNav — selection", () => {
  it("selects the focused node with Enter", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter");
    expect(store.getState().selectedNodeIds).toEqual(["centre"]);
  });

  it("selects with Space too", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, " ");
    expect(store.getState().selectedNodeIds).toEqual(["centre"]);
  });

  it("adds to the selection with Shift+Enter", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight"); // centre
    press(hook, "Enter");
    press(hook, "ArrowRight"); // right
    press(hook, "Enter", { shiftKey: true });
    expect(store.getState().selectedNodeIds.toSorted()).toEqual(["centre", "right"]);
  });

  it("clears the selection with Escape", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter");
    press(hook, "Escape");
    expect(store.getState().selectedNodeIds).toEqual([]);
  });
});

describe("useKeyboardNav — moving nodes", () => {
  it("nudges the selection with Alt+arrow", () => {
    const { hook, store, onNodeMove } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter");
    press(hook, "ArrowRight", { altKey: true });
    expect(store.getState().positions.centre).toEqual({ x: 20, y: 0 });
    expect(onNodeMove).toHaveBeenCalledWith("centre", 20, 0);
  });

  it("uses a larger step with Shift", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter");
    press(hook, "ArrowDown", { altKey: true, shiftKey: true });
    expect(store.getState().positions.centre).toEqual({ x: 0, y: 100 });
  });

  it("nudges the focused node when nothing is selected", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight"); // focus only
    press(hook, "ArrowLeft", { altKey: true });
    expect(store.getState().positions.centre).toEqual({ x: -20, y: 0 });
  });

  it("moves every selected node together", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight"); // centre
    press(hook, "Enter");
    press(hook, "ArrowRight"); // right
    press(hook, "Enter", { shiftKey: true });
    press(hook, "ArrowUp", { altKey: true });
    expect(store.getState().positions.centre).toEqual({ x: 0, y: -20 });
    expect(store.getState().positions.right).toEqual({ x: 200, y: -20 });
  });

  it("leaves the transient depth balanced after a nudge", () => {
    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter");
    press(hook, "ArrowRight", { altKey: true });
    expect(store.getState().transientDepth).toBe(0);
  });
});

describe("useKeyboardNav — connecting", () => {
  it("connects two nodes with c then Enter", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    press(hook, "ArrowRight"); // centre
    press(hook, "c");
    expect(hook.result.current.connectFromId).toBe("centre");
    press(hook, "ArrowRight"); // right
    press(hook, "Enter");
    expect(onConnect).toHaveBeenCalledWith({ source: "centre", target: "right" });
    expect(hook.result.current.connectFromId).toBeNull();
  });

  it("cancels a pending connect with Escape, keeping the selection", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook, store } = setup({ onConnect });
    press(hook, "ArrowRight");
    press(hook, "Enter");
    press(hook, "c");
    press(hook, "Escape");
    expect(hook.result.current.connectFromId).toBeNull();
    expect(store.getState().selectedNodeIds).toEqual(["centre"]);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("does not arm connect when the graph cannot create edges", () => {
    const { hook } = setup();
    press(hook, "ArrowRight");
    press(hook, "c");
    expect(hook.result.current.connectFromId).toBeNull();
  });
});

describe("useKeyboardNav — event ownership", () => {
  /** A key event that bubbled up from `el`, the way real ones reach the
   *  container (which has no tabIndex of its own). */
  function keyFrom(el: Element, k: string) {
    return { ...key(k), target: el } as unknown as React.KeyboardEvent;
  }

  const pressFrom = (hook: ReturnType<typeof setup>["hook"], el: Element, k: string) =>
    act(() => hook.result.current.onKeyDown(keyFrom(el, k)));

  it("ignores keys typed into a consumer's input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { hook } = setup({ onConnect: () => {} });
    press(hook, "ArrowRight"); // focus centre via the graph itself

    pressFrom(hook, input, "ArrowRight");
    expect(hook.result.current.focusedId).toBe("centre"); // focus did not move
    pressFrom(hook, input, "c");
    expect(hook.result.current.connectFromId).toBeNull(); // "c" was just a letter
  });

  it("ignores keys from canvas chrome", () => {
    const chrome = document.createElement("div");
    chrome.setAttribute("data-gc-chrome", "");
    const button = document.createElement("button");
    chrome.appendChild(button);
    document.body.appendChild(chrome);

    const { hook, store } = setup();
    press(hook, "ArrowRight");
    press(hook, "Enter"); // select centre
    pressFrom(hook, button, "Escape");
    expect(store.getState().selectedNodeIds).toEqual(["centre"]);
  });

  it("leaves Ctrl/Cmd-modified keys to the browser", () => {
    // Regression: `c` matched on `e.key` alone, so Cmd+C on a focused node
    // armed a connect *and* preventDefault'd the copy. Every binding here is
    // unmodified or uses Alt/Shift, so a Ctrl/Cmd combo is never the graph's.
    for (const mod of ["ctrlKey", "metaKey"] as const) {
      const { hook } = setup({ onConnect: () => {} });
      press(hook, "ArrowRight"); // focus centre

      const copy = key("c", { [mod]: true });
      act(() => hook.result.current.onKeyDown(copy));
      expect(hook.result.current.connectFromId).toBeNull();
      expect(copy.preventDefault).not.toHaveBeenCalled();

      // ...while the unmodified key still arms the connect.
      press(hook, "c");
      expect(hook.result.current.connectFromId).toBe("centre");
      cleanup();
    }
  });

  it("leaves Cmd+arrow to the browser rather than moving focus", () => {
    const { hook } = setup();
    press(hook, "ArrowRight"); // focus centre
    press(hook, "ArrowRight", { metaKey: true });
    expect(hook.result.current.focusedId).toBe("centre");
  });

  it("still acts on keys from its own accessibility layer", () => {
    // These buttons *are* the graph's keyboard surface, so the guard must not
    // mistake them for consumer controls.
    const a11y = document.createElement("button");
    a11y.setAttribute("data-gc-a11y-node", "centre");
    document.body.appendChild(a11y);

    const { hook } = setup();
    pressFrom(hook, a11y, "ArrowRight");
    expect(hook.result.current.focusedId).toBe("centre");
  });
});

describe("useKeyboardNav — choosing a port pairing", () => {
  // An agent-style target: three distinct typed inputs, so "connect" is
  // ambiguous and the user must be able to pick.
  const SOURCE_OUT: PortDef = { id: "out", type: "main", mode: "output" };
  const MULTI: PortDef[] = [
    SOURCE_OUT,
    { id: "in", type: "main", mode: "input" },
  ];

  it("exposes the pairing Enter would commit", () => {
    const { hook } = setup({ onConnect: () => {}, getNodePorts: () => MULTI, edges: [] });
    press(hook, "ArrowRight"); // centre
    press(hook, "c");
    press(hook, "ArrowRight"); // right
    expect(hook.result.current.connectCandidate).toEqual({
      source: "centre", sourcePort: "out", target: "right", targetPort: "in",
    });
    expect(hook.result.current.connectCandidateCount).toBe(1);
  });

  it("cycles through every valid pairing with the bracket keys", () => {
    // Two same-typed inputs, so there are genuinely two choices.
    const twoInputs: PortDef[] = [
      SOURCE_OUT,
      { id: "in-a", type: "main", mode: "input" },
      { id: "in-b", type: "main", mode: "input" },
    ];
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect, getNodePorts: () => twoInputs, edges: [] });
    press(hook, "ArrowRight");
    press(hook, "c");
    press(hook, "ArrowRight");
    expect(hook.result.current.connectCandidateCount).toBe(2);
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-a");

    press(hook, "]");
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-b");
    press(hook, "]"); // wraps
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-a");
    press(hook, "["); // wraps backwards
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-b");

    press(hook, "Enter");
    expect(onConnect).toHaveBeenCalledWith({
      source: "centre", sourcePort: "out", target: "right", targetPort: "in-b",
    });
  });

  it("resets the choice when the target changes", () => {
    const twoInputs: PortDef[] = [
      SOURCE_OUT,
      { id: "in-a", type: "main", mode: "input" },
      { id: "in-b", type: "main", mode: "input" },
    ];
    const { hook } = setup({ onConnect: () => {}, getNodePorts: () => twoInputs, edges: [] });
    press(hook, "ArrowRight");
    press(hook, "c");
    press(hook, "ArrowRight");
    press(hook, "]");
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-b");
    press(hook, "ArrowUp"); // move to a different node
    expect(hook.result.current.connectCandidate?.targetPort).toBe("in-a");
  });

  it("agrees with the pointer path on output-only nodes", () => {
    // Regression: enumerating every port made the only target candidate an
    // *output*, which the validator rejects — so `c` then Enter produced
    // nothing, while a pointer drag to the same node succeeded at its
    // perimeter. This is the shape `singleOutputPort` gives the demos.
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({
      onConnect,
      getNodePorts: () => [SOURCE_OUT],
      edges: [],
    });
    press(hook, "ArrowRight");
    press(hook, "c");
    press(hook, "ArrowRight");
    press(hook, "Enter");
    expect(onConnect).toHaveBeenCalledWith({
      source: "centre", sourcePort: "out", target: "right", targetPort: undefined,
    });
  });

  it("ignores the bracket keys when there is nothing to choose", () => {
    const { hook } = setup({ onConnect: () => {}, getNodePorts: () => MULTI, edges: [] });
    press(hook, "ArrowRight");
    press(hook, "]");
    expect(hook.result.current.connectCandidate).toBeNull();
  });
});

describe("useKeyboardNav — edges", () => {
  const edgeIds = ["e1", "e2", "e3"];
  /** A key event that bubbled from an edge option in the a11y layer. */
  function edgeKey(k: string) {
    const el = document.createElement("button");
    el.setAttribute("data-gc-a11y-edge", "e1");
    document.body.appendChild(el);
    return { ...key(k), target: el } as unknown as React.KeyboardEvent;
  }
  const pressEdge = (hook: ReturnType<typeof setup>["hook"], k: string) =>
    act(() => { hook.result.current.onKeyDown(edgeKey(k)); });

  it("moves between edges with the arrow keys", () => {
    const { hook } = setup({ edgeIds });
    pressEdge(hook, "ArrowDown");
    expect(hook.result.current.focusedEdgeId).toBe("e1");
    pressEdge(hook, "ArrowDown");
    expect(hook.result.current.focusedEdgeId).toBe("e2");
    pressEdge(hook, "ArrowUp");
    expect(hook.result.current.focusedEdgeId).toBe("e1");
  });

  it("jumps to the ends with Home and End", () => {
    const { hook } = setup({ edgeIds });
    pressEdge(hook, "End");
    expect(hook.result.current.focusedEdgeId).toBe("e3");
    pressEdge(hook, "Home");
    expect(hook.result.current.focusedEdgeId).toBe("e1");
  });

  it("activates the focused edge on Enter", () => {
    const onEdgeActivate = vi.fn<(id: string) => void>();
    const { hook } = setup({ edgeIds, onEdgeActivate });
    pressEdge(hook, "End");
    pressEdge(hook, "Enter");
    expect(onEdgeActivate).toHaveBeenCalledWith("e3");
  });

  it("does not move node focus when the key came from an edge", () => {
    const { hook } = setup({ edgeIds });
    press(hook, "ArrowRight"); // focus a node first
    expect(hook.result.current.focusedId).toBe("centre");
    pressEdge(hook, "ArrowDown");
    expect(hook.result.current.focusedId).toBe("centre");
  });

});

describe("useKeyboardNav — connect validation", () => {
  const PORTS: PortDef[] = [
    { id: "in", type: "main", mode: "input", maxConnections: 1 },
    { id: "out", type: "main", mode: "output" },
  ];

  /** Arm connect on `centre`, then commit onto `right`. */
  function connectCentreToRight(hook: ReturnType<typeof setup>["hook"]) {
    press(hook, "ArrowRight"); // centre
    press(hook, "c");
    press(hook, "ArrowRight"); // right
    press(hook, "Enter");
  }

  it("names ports on both ends rather than emitting a portless connection", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect, getNodePorts: () => PORTS, edges: [] });
    connectCentreToRight(hook);
    expect(onConnect).toHaveBeenCalledWith({
      source: "centre", sourcePort: "out", target: "right", targetPort: "in",
    });
  });

  it("refuses a connection the pointer path would also refuse", () => {
    // Regression: this path used to call onConnect raw, so maxConnections and
    // isValidConnection were enforced for drags but not for the keyboard.
    const onConnect = vi.fn<(c: Connection) => void>();
    const edges: GraphEdge<unknown>[] = [
      { id: "e1", source: "centre", target: "right", data: {}, sourcePort: "out", targetPort: "in" },
    ];
    const { hook } = setup({ onConnect, getNodePorts: () => PORTS, edges });
    connectCentreToRight(hook);
    expect(onConnect).not.toHaveBeenCalled();
    // Still disarmed, so the graph isn't stuck in connect mode.
    expect(hook.result.current.connectFromId).toBeNull();
  });

  it("honours the consumer's isValidConnection", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const isValidConnection = vi.fn<(c: ConnectionContext<unknown>) => boolean>(() => false);
    const { hook } = setup({ onConnect, getNodePorts: () => PORTS, edges: [], isValidConnection });
    connectCentreToRight(hook);
    expect(isValidConnection).toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("still connects portless nodes at the perimeter", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect, validated: true, edges: [] });
    connectCentreToRight(hook);
    expect(onConnect).toHaveBeenCalledWith({
      source: "centre", sourcePort: undefined, target: "right", targetPort: undefined,
    });
  });
});
