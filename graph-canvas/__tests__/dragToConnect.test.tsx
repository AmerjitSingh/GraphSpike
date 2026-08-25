// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useDragToConnect } from "../hooks/useDragToConnect";
import { createGraphLink } from "../link/GraphLink";
import { SpatialIndex } from "../spatialIndex";
import { createConnectionValidator } from "../validation";
import type {
  Connection,
  ConnectionContext,
  GraphEdge,
  GraphNode,
  NodePosition,
  NodeSize,
  PortDef,
} from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const positions: Record<string, NodePosition> = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };

function makeContainer(id?: string) {
  const el = document.createElement("div");
  if (id) el.setAttribute("data-gc-graph-id", id);
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  document.body.appendChild(el);
  return el;
}

function setup(over: {
  onConnect?: (c: Connection) => void;
  crossGraphDrag?: boolean;
  link?: ReturnType<typeof createGraphLink> | null;
  graphId?: string;
  getNodePorts?: (n: GraphNode<Data>) => PortDef[];
  getNodeSize?: (n: GraphNode<Data>) => NodeSize;
  edges?: GraphEdge<unknown>[];
  isValidConnection?: (c: ConnectionContext<Data>) => boolean;
} = {}) {
  const container = makeContainer(over.graphId);
  const index = new SpatialIndex<Data>();
  if (over.getNodePorts) index.configurePorts(over.getNodePorts, over.getNodeSize);
  index.rebuild(nodes, positions, () => 20);
  // Mirror production: GraphCanvas builds one validator and hands the same
  // instance to every path that can create an edge.
  const validateConnection = createConnectionValidator<Data, unknown>({
    nodeById,
    getNodePorts: over.getNodePorts,
    edges: over.edges,
    isValidConnection: over.isValidConnection,
  });
  const hook = renderHook(() =>
    useDragToConnect<Data>({
      containerRef: { current: container },
      viewport: { x: 0, y: 0, zoom: 1 },
      positions,
      nodeById,
      spatialIndex: { current: index },
      resolvedGetNodeRadius: () => 20,
      onConnect: over.onConnect,
      portResolver: over.getNodePorts
        ? { getNodePorts: over.getNodePorts, getNodeSize: over.getNodeSize }
        : undefined,
      validateConnection,
      link: over.link ?? null,
      graphId: over.graphId,
      crossGraphDrag: over.crossGraphDrag ?? false,
    })
  );
  return { hook, container };
}

/** jsdom may not implement elementFromPoint at all, so assign rather than spy. */
function stubElementFromPoint(el: Element | null) {
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  const original = doc.elementFromPoint;
  doc.elementFromPoint = () => el;
  return () => {
    if (original) doc.elementFromPoint = original;
    else delete doc.elementFromPoint;
  };
}

function evt(over: Record<string, unknown> = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...over,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("useDragToConnect — drag line", () => {
  it("starts with no line", () => {
    const { hook } = setup();
    expect(hook.result.current.dragLine).toBeNull();
  });

  it("opens a line at the connector position", () => {
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 5, 6, undefined, 1));
    const line = hook.result.current.dragLine!;
    expect(line.sourceId).toBe("a");
    expect(line.source).toEqual({ x: 5, y: 6 });
    expect(line.target).toEqual({ x: 5, y: 6 });
    expect(line.snapId).toBeNull();
  });

  it("follows the pointer over blank canvas", () => {
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 400, clientY: 300 })));
    expect(hook.result.current.dragLine!.snapId).toBeNull();
  });

  it("snaps to a nearby node", () => {
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 210, clientY: 5 })));
    expect(hook.result.current.dragLine!.snapId).toBe("b");
  });

  it("never snaps back to the source node", () => {
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 2, clientY: 2 })));
    expect(hook.result.current.dragLine!.snapId).toBeNull();
  });

  it("abandons a stale drag when no button is held", () => {
    // Recovery for a pointerup that was missed (drag left before capture).
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 100, clientY: 0, buttons: 0 })));
    expect(hook.result.current.dragLine).toBeNull();
  });

  it("clears on cancel without creating an edge", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 210, clientY: 5 })));
    act(() => hook.result.current.onContainerPointerCancel(evt()));
    expect(hook.result.current.dragLine).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("ignores move, up and cancel events from a different pointer", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));

    act(() => hook.result.current.onContainerPointerMove(evt({
      pointerId: 2,
      clientX: 210,
      clientY: 5,
    })));
    expect(hook.result.current.dragLine).toMatchObject({
      target: { x: 0, y: 0 },
      snapId: null,
    });

    act(() => hook.result.current.onContainerPointerUp(evt({ pointerId: 2 })));
    expect(hook.result.current.dragLine).not.toBeNull();
    act(() => hook.result.current.onContainerPointerCancel(evt({ pointerId: 2 })));
    expect(hook.result.current.dragLine).not.toBeNull();
    expect(onConnect).not.toHaveBeenCalled();

    act(() => hook.result.current.onContainerPointerCancel(evt({ pointerId: 1 })));
    expect(hook.result.current.dragLine).toBeNull();
  });

  it("does not let another pointer replace an in-flight connection", () => {
    const { hook } = setup();
    act(() => hook.result.current.onConnectStart("a", 5, 6, undefined, 1));
    act(() => hook.result.current.onConnectStart("b", 100, 200, undefined, 2));
    expect(hook.result.current.dragLine).toMatchObject({
      sourceId: "a",
      source: { x: 5, y: 6 },
    });
  });

  it("expires click suppression when a captured drag emits no click", () => {
    vi.useFakeTimers();
    try {
      const { hook } = setup();
      act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
      act(() =>
        hook.result.current.onContainerPointerMove(evt({
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }))
      );
      act(() =>
        hook.result.current.onContainerPointerUp(evt({
          pointerId: 1,
          clientX: 100,
          clientY: 100,
          buttons: 0,
        }))
      );
      expect(hook.result.current.justConnectedRef.current).toBe(true);
      act(() => { vi.runAllTimers(); });
      expect(hook.result.current.justConnectedRef.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useDragToConnect — commit", () => {
  it("creates an edge when released on a snapped node", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 210, clientY: 5 })));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 210, clientY: 5 })));
    expect(onConnect).toHaveBeenCalledWith({ source: "a", sourcePort: undefined, target: "b", targetPort: undefined });
    expect(hook.result.current.dragLine).toBeNull();
  });

  it("creates nothing when released over blank canvas", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 600, clientY: 400 })));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 600, clientY: 400 })));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("flags a captured drag so the retargeted click is ignored", () => {
    const { hook } = setup({ onConnect: () => {} });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 210, clientY: 5 })));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 210, clientY: 5 })));
    expect(hook.result.current.justConnectedRef.current).toBe(true);
  });

  it("does nothing on a pointerup with no drag in flight", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ onConnect });
    act(() => hook.result.current.onContainerPointerUp(evt()));
    expect(onConnect).not.toHaveBeenCalled();
  });
});

describe("useDragToConnect — port validation", () => {
  // 100x100 nodes: a's ports sit at (-50,0)/(50,0), b's at (150,0)/(250,0).
  const SIZE: NodeSize = { width: 100, height: 100 };
  const PORTS: PortDef[] = [
    { id: "in", type: "main", mode: "input", maxConnections: 1 },
    { id: "out", type: "main", mode: "output" },
  ];
  const withPorts = {
    getNodePorts: () => PORTS,
    getNodeSize: () => SIZE,
  };

  /** Drag from a's output port and release on b's input port at (150, 0). */
  function dragOntoTargetPort(hook: ReturnType<typeof setup>["hook"]) {
    act(() => hook.result.current.onConnectStart("a", 50, 0, "out", 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 150, clientY: 0 })));
  }

  it("connects port to port when the target port has room", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ ...withPorts, onConnect, edges: [] });
    dragOntoTargetPort(hook);
    expect(hook.result.current.dragLine).toMatchObject({ snapId: "b", snapPort: "in", isValid: true });
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 150, clientY: 0 })));
    expect(onConnect).toHaveBeenCalledWith({
      source: "a", sourcePort: "out", target: "b", targetPort: "in",
    });
  });

  it("holds the snap on a full port instead of degrading to the node", () => {
    // Regression: the node snap radius (60) strictly contains the port radius
    // (34), so a rejected port used to fall through to its owning node with
    // `targetPort: undefined` — which has no port to count against, so
    // maxConnections was bypassed and the resulting edge was itself portless.
    const onConnect = vi.fn<(c: Connection) => void>();
    const edges: GraphEdge<unknown>[] = [
      { id: "e1", source: "a", target: "b", data: {}, sourcePort: "out", targetPort: "in" },
    ];
    const { hook } = setup({ ...withPorts, onConnect, edges });

    dragOntoTargetPort(hook);
    expect(hook.result.current.dragLine).toMatchObject({
      snapId: "b",
      snapPort: "in",
      isValid: false,
    });

    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 150, clientY: 0 })));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("does not degrade when the consumer rejects the port either", () => {
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({
      ...withPorts,
      onConnect,
      edges: [],
      isValidConnection: () => false,
    });
    dragOntoTargetPort(hook);
    expect(hook.result.current.dragLine).toMatchObject({ snapPort: "in", isValid: false });
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 150, clientY: 0 })));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("refuses a node-level snap onto a ported node", () => {
    // Well away from either of b's ports but inside the 60px node radius.
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ ...withPorts, onConnect, edges: [] });
    act(() => hook.result.current.onConnectStart("a", 50, 0, "out", 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 200, clientY: 45 })));
    expect(hook.result.current.dragLine).toMatchObject({
      snapId: "b",
      snapPort: undefined,
      isValid: false,
    });
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 200, clientY: 45 })));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("still snaps past a rejected port to a valid one behind it", () => {
    // Two inputs stacked on b's left edge at (150,-16.7) and (150,16.7). The
    // nearer one is full, so the filtered search must skip it and keep looking
    // rather than giving up and falling back to the node.
    const TWO_INPUTS: PortDef[] = [
      { id: "in", type: "main", mode: "input", side: "left", maxConnections: 1 },
      { id: "in2", type: "main", mode: "input", side: "left" },
      { id: "out", type: "main", mode: "output", side: "right" },
    ];
    const edges: GraphEdge<unknown>[] = [
      { id: "e1", source: "a", target: "b", data: {}, sourcePort: "out", targetPort: "in" },
    ];
    const { hook } = setup({
      getNodePorts: () => TWO_INPUTS,
      getNodeSize: () => SIZE,
      edges,
    });
    // Nearest to the *full* port, so a naive search would stop there.
    act(() => hook.result.current.onConnectStart("a", 50, 0, "out", 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 150, clientY: -10 })));
    expect(hook.result.current.dragLine).toMatchObject({
      snapId: "b",
      snapPort: "in2",
      isValid: true,
    });
  });

  it("does not treat an output port as a drop target when the node requires an input", () => {
    // b's output sits at (250,0). It is not a target affordance, and b also has
    // an input port, so the node-level fallback remains invalid.
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ ...withPorts, onConnect, edges: [], isValidConnection: () => true });
    act(() => hook.result.current.onConnectStart("a", 50, 0, "out", 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 250, clientY: 0 })));
    expect(hook.result.current.dragLine).toMatchObject({
      snapId: "b",
      snapPort: "out",
      isValid: false,
    });
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 250, clientY: 0 })));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("keeps a perimeter drop valid when hovering an output-only target's port", () => {
    // This is the graph-editor setup: every node exposes one output handle but
    // accepts incoming edges at its perimeter. The output glyph overlaps the
    // node's snap area and used to turn the preview red even though moving a
    // few pixels away produced a valid connection.
    const outputOnly: PortDef[] = [
      { id: "out", type: "main", mode: "output" },
    ];
    const wideSize: NodeSize = { width: 200, height: 100 };
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({
      getNodePorts: () => outputOnly,
      getNodeSize: () => wideSize,
      onConnect,
      edges: [],
    });

    // The output is 100px from b's centre, deliberately outside the ordinary
    // 60px node snap radius. Its owner still provides the valid perimeter.
    act(() => hook.result.current.onConnectStart("a", 100, 0, "out", 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 300, clientY: 0 })));
    expect(hook.result.current.dragLine).toMatchObject({
      snapId: "b",
      snapPort: undefined,
      isValid: true,
    });

    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 300, clientY: 0 })));
    expect(onConnect).toHaveBeenCalledWith({
      source: "a",
      sourcePort: "out",
      target: "b",
      targetPort: undefined,
    });
  });
});

describe("useDragToConnect — cross-graph drop", () => {
  it("hands the node to a peer graph and maps the point into its space", () => {
    const link = createGraphLink();
    const onExternalDrop = vi.fn<(p: unknown, x: number, y: number) => void>();

    // A registered peer whose container sits to the right of the source.
    const peerEl = document.createElement("div");
    peerEl.setAttribute("data-gc-graph-id", "B");
    peerEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 1000, top: 0, right: 1800, bottom: 600, width: 800, height: 600, toJSON() {} });
    document.body.appendChild(peerEl);
    link.register("B", {
      getHandle: () => null,
      getContainer: () => peerEl,
      getViewport: () => ({ x: 100, y: 50, zoom: 2 }),
      getOnExternalDrop: () => onExternalDrop,
    });

    // elementFromPoint drives target resolution; point it at the peer.
    const restore = stubElementFromPoint(peerEl);

    const { hook } = setup({ crossGraphDrag: true, link, graphId: "A" });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 1300, clientY: 250 })));

    expect(onExternalDrop).toHaveBeenCalledTimes(1);
    const [payload, gx, gy] = onExternalDrop.mock.calls[0];
    expect(payload).toEqual({ sourceGraphId: "A", nodeId: "a", key: "a" });
    // ((1300-1000)-100)/2 = 100 ; ((250-0)-50)/2 = 100
    expect(gx).toBeCloseTo(100);
    expect(gy).toBeCloseTo(100);

    restore();
    peerEl.remove();
  });

  it("falls back to local edge creation when the peer accepts no drops", () => {
    const link = createGraphLink();
    const peerEl = document.createElement("div");
    peerEl.setAttribute("data-gc-graph-id", "B");
    peerEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 1000, top: 0, right: 1800, bottom: 600, width: 800, height: 600, toJSON() {} });
    document.body.appendChild(peerEl);
    link.register("B", {
      getHandle: () => null,
      getContainer: () => peerEl,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      getOnExternalDrop: () => undefined,
    });
    const restore = stubElementFromPoint(peerEl);

    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook } = setup({ crossGraphDrag: true, link, graphId: "A", onConnect });
    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 1300, clientY: 250 })));

    // No snap target locally, so nothing is created — but crucially the drop
    // was not swallowed by a peer that cannot accept it.
    expect(onConnect).not.toHaveBeenCalled();
    expect(hook.result.current.dragLine).toBeNull();

    restore();
    peerEl.remove();
  });

  it("treats a release over its own container as a local drop", () => {
    const link = createGraphLink();
    const onConnect = vi.fn<(c: Connection) => void>();
    const { hook, container } = setup({
      crossGraphDrag: true, link, graphId: "A", onConnect,
    });
    link.register("A", {
      getHandle: () => null,
      getContainer: () => container,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      getOnExternalDrop: () => vi.fn<(p: unknown, x: number, y: number) => void>(),
    });
    const restore = stubElementFromPoint(container);

    act(() => hook.result.current.onConnectStart("a", 0, 0, undefined, 1));
    act(() => hook.result.current.onContainerPointerMove(evt({ clientX: 210, clientY: 5 })));
    act(() => hook.result.current.onContainerPointerUp(evt({ clientX: 210, clientY: 5 })));

    expect(onConnect).toHaveBeenCalledWith({ source: "a", sourcePort: undefined, target: "b", targetPort: undefined });
    restore();
  });
});
