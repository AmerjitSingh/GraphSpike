// @vitest-environment jsdom
import "./setup.dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraphCanvas } from "../GraphCanvas";
import {
  getEdgeAnchors,
  getEdgeControlPoints,
  getEdgeRouteGeometry,
} from "../geometry";
import type {
  GraphCanvasRef,
  GraphContextMenuProps,
  Connection,
  GraphEdge,
  GraphNode,
  NodePosition,
  NodeRenderProps,
  NodeSize,
  PortDef,
} from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];
const edges: GraphEdge<unknown>[] = [];
const positions: Record<string, NodePosition> = {
  a: { x: -100, y: 0 },
  b: { x: 100, y: 0 },
};

function mouse(type: string, init: MouseEventInit = {}) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}
function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, ...init });
}

// Graph origin is screen (400,300) — see setup.dom. An edge between a(-100,0)
// and b(100,0) therefore runs along y=300 between x=300 and x=500.
const linked: GraphEdge<unknown>[] = [{ id: "e1", source: "a", target: "b", data: null }];

const edgeCanvas = (c: HTMLElement) => c.querySelector("[data-gc-edge-canvas]") as HTMLElement;

describe("GraphCanvas — keyboard reach", () => {
  it("exposes every edge as a focusable option", () => {
    // The edge canvas is aria-hidden raster, so without this listbox edges are
    // unreachable by keyboard entirely.
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
      />
    );
    const edgeOptions = container.querySelectorAll("[data-gc-a11y-edge]");
    expect(edgeOptions).toHaveLength(1);
    expect(edgeOptions[0].getAttribute("data-gc-a11y-edge")).toBe("e1");
    expect(container.querySelector('[aria-label="Graph edges"]')).not.toBeNull();
  });

  it("uses getEdgeLabel for the accessible name", () => {
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
        getEdgeLabel={() => "flows into"}
      />
    );
    expect(container.querySelector("[data-gc-a11y-edge]")?.textContent).toContain("flows into");
  });

  it("activates an edge on Enter", () => {
    const onEdgeActivate = vi.fn<(id: string) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
        onEdgeActivate={onEdgeActivate}
      />
    );
    const option = container.querySelector("[data-gc-a11y-edge]") as HTMLElement;
    act(() => { option.focus(); });
    act(() => {
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onEdgeActivate).toHaveBeenCalledWith("e1");
  });

  it("activates a semantic edge click without falling through to canvas hit-testing", () => {
    const onEdgeActivate = vi.fn<(id: string) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
        onEdgeActivate={onEdgeActivate}
      />
    );
    const option = container.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
    act(() => { option.dispatchEvent(mouse("click")); });
    expect(onEdgeActivate).toHaveBeenCalledWith("e1");
  });

  it("renders no edge listbox when there are no edges", () => {
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={[]}
        initialPositions={positions}
        layoutEnabled={false}
      />
    );
    expect(container.querySelector('[aria-label="Graph edges"]')).toBeNull();
  });
});

describe("GraphCanvas — edge toolbar", () => {
  function renderWithToolbar(over: Record<string, unknown> = {}) {
    const renderEdgeToolbar = vi.fn<() => React.ReactNode>(() => (
      <button type="button" data-testid="edge-tool">delete</button>
    ));
    const utils = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
        renderEdgeToolbar={renderEdgeToolbar}
        {...over}
      />
    );
    return { ...utils, renderEdgeToolbar };
  }

  it("shows the toolbar only after the dwell delay", () => {
    vi.useFakeTimers();
    try {
      const { container, queryByTestId } = renderWithToolbar({ edgeToolbarDelay: 600 });
      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
      });
      expect(queryByTestId("edge-tool")).toBeNull();

      act(() => { vi.advanceTimersByTime(600); });
      expect(queryByTestId("edge-tool")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open while the pointer moves onto it", () => {
    // Regression: the toolbar is a sibling overlay, so leaving the edge fires
    // pointerleave on the canvas before pointerenter on the toolbar. Closing
    // synchronously made it impossible to reach.
    vi.useFakeTimers();
    try {
      const { container, queryByTestId } = renderWithToolbar({ edgeToolbarDelay: 0 });
      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
      });
      act(() => { vi.advanceTimersByTime(0); });
      const toolbar = queryByTestId("edge-tool");
      expect(toolbar).not.toBeNull();

      // Pointer leaves the edge on its way to the toolbar...
      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 500 }));
      });
      // ...and arrives before the grace period elapses. React synthesises
      // pointerenter from pointerover, so dispatch the underlying event.
      act(() => { vi.advanceTimersByTime(50); });
      act(() => {
        toolbar!.dispatchEvent(
          new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body })
        );
      });
      act(() => { vi.advanceTimersByTime(1000); });

      expect(queryByTestId("edge-tool")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes when the pointer leaves and does not come back", () => {
    vi.useFakeTimers();
    try {
      const { container, queryByTestId } = renderWithToolbar({ edgeToolbarDelay: 0 });
      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
      });
      act(() => { vi.advanceTimersByTime(0); });
      expect(queryByTestId("edge-tool")).not.toBeNull();

      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 500 }));
      });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(queryByTestId("edge-tool")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports edge hover to the consumer regardless of the toolbar", () => {
    const onEdgeHover = vi.fn<(id: string | null) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
        onEdgeHover={onEdgeHover}
      />
    );
    act(() => {
      edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
    });
    expect(onEdgeHover).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("reveals the edge toolbar when the semantic edge receives keyboard focus", () => {
    const { container, queryByTestId } = renderWithToolbar();
    const option = container.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
    act(() => { option.focus(); });
    const control = queryByTestId("edge-tool");
    expect(control).not.toBeNull();
    const toolbar = control?.closest('[role="toolbar"]') as HTMLElement;
    expect(toolbar.getAttribute("data-gc-edge-toolbar")).toBe("e1");
    act(() => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })
      );
    });
    expect(queryByTestId("edge-tool")).not.toBeNull();
  });

  it("anchors the toolbar to the same midpoint the edge is painted at", () => {
    // Regression: `resolveEdgeVisual` resolved control points without the port
    // normals that EdgeCanvasLayer paints with. For an s-curved port-to-port
    // edge the two then take different branches of getSCurvedEdgeControlPoints
    // — axis-inferred vs. port-face — and the toolbar anchored tens of graph
    // units off the curve the user is looking at.
    const size: NodeSize = { width: 160, height: 80 };
    // Right face out, top face in: the axes disagree, which is exactly the
    // case the two branches resolve differently.
    const ports: Record<string, PortDef[]> = {
      a: [{ id: "out", type: "main", mode: "output" }],
      b: [{ id: "in", type: "main", mode: "input", side: "top" }],
    };
    const portedPositions: Record<string, NodePosition> = {
      a: { x: -100, y: -100 },
      b: { x: 100, y: 100 },
    };
    const portedEdge: GraphEdge<unknown>[] = [
      { id: "e1", source: "a", target: "b", data: null, sourcePort: "out", targetPort: "in" },
    ];
    const getNodePorts = (n: GraphNode<Data>) => ports[n.id] ?? [];
    const getNodeSize = () => size;

    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={portedEdge}
        initialPositions={portedPositions}
        layoutEnabled={false}
        getNodePorts={getNodePorts}
        getNodeSize={getNodeSize}
        getEdgeRoute={() => "s-curved"}
        renderEdgeToolbar={() => <button type="button">delete</button>}
      />
    );

    // Independently reproduce what the canvas layer draws.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const portResolver = { getNodePorts, getNodeSize };
    const anchors = getEdgeAnchors(
      nodeById.get("a")!,
      nodeById.get("b")!,
      portedPositions,
      undefined,
      undefined,
      "out",
      "in",
      portResolver
    )!;
    expect(anchors.sourceNormal).toEqual({ x: 1, y: 0 });
    expect(anchors.targetNormal).toEqual({ x: 0, y: -1 });
    const painted = getEdgeRouteGeometry(
      anchors.source,
      anchors.target,
      "s-curved",
      1,
      getEdgeControlPoints(
        anchors.source,
        anchors.target,
        1,
        "s-curved",
        anchors.sourceNormal,
        anchors.targetNormal
      )
    ).labelPosition;

    // Guard the guard: without the normals the midpoint genuinely differs, so
    // this test cannot pass by comparing two identical branches.
    const normalless = getEdgeRouteGeometry(
      anchors.source,
      anchors.target,
      "s-curved",
      1,
      getEdgeControlPoints(anchors.source, anchors.target, 1, "s-curved")
    ).labelPosition;
    expect(Math.hypot(painted.x - normalless.x, painted.y - normalless.y)).toBeGreaterThan(20);

    const option = container.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
    act(() => { option.focus(); });
    const toolbar = container.querySelector('[data-gc-edge-toolbar="e1"]') as HTMLElement;
    expect(toolbar).not.toBeNull();

    // Graph origin sits at screen (400, 300) at zoom 1 — see setup.dom.
    expect(Number.parseFloat(toolbar.style.left)).toBeCloseTo(painted.x + 400, 5);
    expect(Number.parseFloat(toolbar.style.top)).toBeCloseTo(painted.y + 300, 5);
  });

  it("does not retarget a focused toolbar when the pointer hovers another edge", () => {
    vi.useFakeTimers();
    try {
      const squareNodes: GraphNode<Data>[] = [
        { id: "a", data: { label: "A" } },
        { id: "b", data: { label: "B" } },
        { id: "c", data: { label: "C" } },
        { id: "d", data: { label: "D" } },
      ];
      const squarePositions: Record<string, NodePosition> = {
        a: { x: -100, y: -100 },
        b: { x: 100, y: -100 },
        c: { x: -100, y: 100 },
        d: { x: 100, y: 100 },
      };
      const parallelEdges: GraphEdge<unknown>[] = [
        { id: "e1", source: "a", target: "b", data: null },
        { id: "e2", source: "c", target: "d", data: null },
      ];
      const { container, getByTestId } = render(
        <GraphCanvas<Data, unknown>
          nodes={squareNodes}
          edges={parallelEdges}
          initialPositions={squarePositions}
          layoutEnabled={false}
          edgeToolbarDelay={100}
          renderEdgeToolbar={({ edge }) => (
            <button type="button" data-testid={`edge-tool-${edge.id}`}>{edge.id}</button>
          )}
        />
      );

      const firstEdge = container.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
      act(() => { firstEdge.focus(); });
      const firstTool = getByTestId("edge-tool-e1");
      act(() => { firstTool.focus(); });

      // e2 runs horizontally through screen y=400. Its dwell must not replace
      // the e1 toolbar while a keyboard user is focused inside that toolbar.
      act(() => {
        edgeCanvas(container).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 400 }));
        vi.advanceTimersByTime(100);
      });

      expect(container.querySelector('[data-gc-edge-toolbar="e1"]')).not.toBeNull();
      expect(container.querySelector('[data-gc-edge-toolbar="e2"]')).toBeNull();
      expect(document.activeElement).toBe(firstTool);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables native touch panning on the background gesture surface", () => {
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={linked}
        initialPositions={positions}
        layoutEnabled={false}
      />
    );
    expect(edgeCanvas(container).style.touchAction).toBe("none");
  });

  it("scopes toolbar focus retention to the graph that owns it", () => {
    vi.useFakeTimers();
    try {
      const { container, queryByTestId } = render(
        <>
          <div style={{ width: 800, height: 600 }}>
            <GraphCanvas<Data, unknown>
              className="first-graph"
              nodes={nodes}
              edges={linked}
              initialPositions={positions}
              layoutEnabled={false}
              renderEdgeToolbar={() => (
                <button type="button" data-testid="first-tool">first</button>
              )}
              edgeToolbarDelay={0}
            />
          </div>
          <div style={{ width: 800, height: 600 }}>
            <GraphCanvas<Data, unknown>
              className="second-graph"
              nodes={nodes}
              edges={linked}
              initialPositions={positions}
              layoutEnabled={false}
              renderEdgeToolbar={() => (
                <button type="button" data-testid="second-tool">second</button>
              )}
              edgeToolbarDelay={0}
            />
          </div>
        </>
      );
      const first = container.querySelector(".first-graph") as HTMLElement;
      const second = container.querySelector(".second-graph") as HTMLElement;

      // Focus inside graph one, then independently open and leave graph two.
      const firstEdge = first.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
      act(() => { firstEdge.focus(); });
      act(() => { queryByTestId("first-tool")?.focus(); });
      act(() => {
        edgeCanvas(second).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 300 }));
        vi.advanceTimersByTime(0);
      });
      expect(queryByTestId("second-tool")).not.toBeNull();
      act(() => {
        edgeCanvas(second).dispatchEvent(pointer("pointermove", { clientX: 400, clientY: 500 }));
        vi.advanceTimersByTime(1000);
      });
      expect(queryByTestId("second-tool")).toBeNull();
      expect(queryByTestId("first-tool")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GraphCanvas — canvas chrome must not leak into the graph", () => {
  it("double-clicking the Fit view button does not create a node", () => {
    // Regression: a browser smoke test saw the Graph Editor go 3 -> 4 nodes
    // because onContainerDoubleClick had no chrome exclusion.
    const onCanvasDoubleClick = vi.fn<(x: number, y: number) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onCanvasDoubleClick={onCanvasDoubleClick}
      />
    );

    const fit = container.querySelector("[data-gc-chrome]") as HTMLElement;
    expect(fit).toBeTruthy();
    act(() => {
      fit.dispatchEvent(mouse("dblclick"));
    });
    expect(onCanvasDoubleClick).not.toHaveBeenCalled();
  });

  it("still creates a node when the canvas itself is double-clicked", () => {
    const onCanvasDoubleClick = vi.fn<(x: number, y: number) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onCanvasDoubleClick={onCanvasDoubleClick}
      />
    );
    const canvas = container.querySelector(".gc-canvas") as HTMLElement;
    act(() => {
      canvas.dispatchEvent(mouse("dblclick", { clientX: 400, clientY: 500 }));
    });
    expect(onCanvasDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("clicking the Fit view button does not clear the selection", () => {
    const onSelectionChange = vi.fn<(ids: string[]) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onSelectionChange={onSelectionChange}
      />
    );
    const fit = container.querySelector("[data-gc-chrome]") as HTMLElement;
    onSelectionChange.mockClear();
    act(() => {
      fit.dispatchEvent(mouse("click"));
    });
    // No selection mutation should have been proposed by the chrome click.
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

const renderNodeWithInput = ({ node }: NodeRenderProps<Data>) => (
  <div>
    <span>{node.data.label}</span>
    <input data-testid={`input-${node.id}`} defaultValue="" />
  </div>
);

describe("GraphCanvas — interactive content inside a node", () => {
  it("does not swallow pointerdown on an input rendered inside a node", () => {
    // Selected nodes render through the HTML layer, so select one first.
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        selectedNodeIds={["a"]}
        renderNode={renderNodeWithInput}
      />
    );

    const input = container.querySelector('[data-testid="input-a"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const ev = pointer("pointerdown", { button: 0, buttons: 1, clientX: 10, clientY: 10 });
    act(() => {
      input.dispatchEvent(ev);
    });
    // The node drag handler calls preventDefault(); leaving it un-prevented is
    // what lets the control focus and receive the gesture normally.
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("GraphCanvas — controlled selection", () => {
  it("does not retain a selection the parent rejected", async () => {
    // Parent clamps every proposal back to ["a"]; the store must not keep the
    // rejected value, or the next interaction builds on a phantom selection.
    const seen: string[][] = [];

    function Host() {
      const [selected] = useState<string[]>(["a"]);
      return (
        <GraphCanvas<Data, unknown>
          nodes={nodes}
          edges={edges}
          initialPositions={positions}
          layoutEnabled={false}
          selectedNodeIds={selected}
          onSelectionChange={(ids) => {
            seen.push(ids);
            // deliberately ignored — the parent rejects the proposal
          }}
        />
      );
    }

    const { container } = render(<Host />);
    const canvas = container.querySelector(".gc-canvas") as HTMLElement;

    // Click blank space, which would otherwise clear the store selection.
    await act(async () => {
      canvas.dispatchEvent(mouse("click", { clientX: 700, clientY: 550 }));
    });

    // The a11y layer mirrors the effective selection; "a" must still be marked.
    const optionA = container.querySelector('[data-gc-a11y-node="a"]');
    expect(optionA?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("GraphCanvas — accessibility layer", () => {
  it("exposes every node as a focusable option with a roving tabindex", () => {
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
      />
    );

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox?.getAttribute("aria-label")).toBe("Graph nodes");

    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(nodes.length);
    // Exactly one tab stop for the whole graph.
    const tabbable = [...options].filter((o) => o.getAttribute("tabindex") === "0");
    expect(tabbable.length).toBe(1);
    expect(options[0].textContent).toContain("A");
  });

  it("can be disabled with keyboardNav={false}", () => {
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        keyboardNav={false}
      />
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("selects and reports a semantic node click", () => {
    const onSelectionChange = vi.fn<(ids: string[]) => void>();
    const onNodeClick = vi.fn<(id: string, event: React.MouseEvent) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
      />
    );
    const option = container.querySelector('[data-gc-a11y-node="a"]') as HTMLElement;
    act(() => { option.dispatchEvent(mouse("click")); });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a"]);
    expect(onNodeClick).toHaveBeenCalledWith("a", expect.anything());
  });

  it("fires onNodeClick for keyboard Enter activation too", () => {
    // Keyboard Enter/Space preventDefault the native click, so onNodeClick has
    // to flow through the activation path — otherwise a consumer opening a
    // panel from onNodeClick serves mouse and AT users but not keyboard users.
    const onNodeClick = vi.fn<(id: string, event: React.MouseEvent) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onNodeClick={onNodeClick}
      />
    );
    const option = container.querySelector('[data-gc-a11y-node="a"]') as HTMLElement;
    act(() => { option.focus(); });
    act(() => {
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onNodeClick).toHaveBeenCalledWith("a", expect.anything());
  });

  it("uses semantic node click to complete an armed keyboard connection", () => {
    const onConnect = vi.fn<(connection: Connection) => void>();
    const onNodeClick = vi.fn<(id: string, event: React.MouseEvent) => void>();
    const { container } = render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
      />
    );
    const source = container.querySelector('[data-gc-a11y-node="a"]') as HTMLElement;
    const target = container.querySelector('[data-gc-a11y-node="b"]') as HTMLElement;
    act(() => { source.focus(); });
    act(() => {
      source.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    // Voice control and switch access may activate the target with click only.
    act(() => { target.dispatchEvent(mouse("click")); });
    expect(onConnect).toHaveBeenCalledWith({
      source: "a",
      sourcePort: undefined,
      target: "b",
      targetPort: undefined,
    });
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});

// ─── Canvas hit-testing, hover, menus and the imperative handle ───────────────

/**
 * The container is stubbed at 800x600 and the zoom initialises to
 * translate(w/2, h/2), so at zoom 1 a graph point maps to client + (400, 300).
 */
const GRAPH_ORIGIN = { x: 400, y: 300 };
const toClient = (gx: number, gy: number) => ({
  clientX: GRAPH_ORIGIN.x + gx,
  clientY: GRAPH_ORIGIN.y + gy,
});

function renderGraph(over: Partial<Parameters<typeof GraphCanvas<Data, unknown>>[0]> = {}) {
  const utils = render(
    <GraphCanvas<Data, unknown>
      nodes={nodes}
      edges={edges}
      initialPositions={positions}
      layoutEnabled={false}
      {...over}
    />
  );
  const canvas = utils.container.querySelector(".gc-canvas") as HTMLElement;
  return { ...utils, canvas };
}

function pointerEvt(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, ...init,
  });
}

describe("GraphCanvas — canvas hit-testing", () => {
  it("does not treat a portaled node control click as a canvas click", () => {
    const onSelectionChange = vi.fn<(ids: string[]) => void>();
    const onNodeClick = vi.fn<(id: string) => void>();
    const controlClick = vi.fn<() => void>();
    render(
      <GraphCanvas<Data, unknown>
        nodes={nodes}
        edges={edges}
        initialPositions={positions}
        layoutEnabled={false}
        renderAllNodes
        selectedNodeIds={["a"]}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        renderNode={({ node }) => (
          <>
            <div>{node.id}</div>
            {createPortal(
              <button type="button" data-testid={`portal-${node.id}`} onClick={controlClick}>
                action
              </button>,
              document.body
            )}
          </>
        )}
      />
    );
    onSelectionChange.mockClear();
    const control = document.querySelector('[data-testid="portal-a"]') as HTMLElement;
    act(() => { control.dispatchEvent(mouse("click")); });
    expect(controlClick).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("selects a canvas-drawn node on click", () => {
    const onSelectionChange = vi.fn<(ids: string[]) => void>();
    const onNodeClick = vi.fn<(id: string) => void>();
    const { canvas } = renderGraph({ onSelectionChange, onNodeClick });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...toClient(-100, 0) }));
    });
    expect(onNodeClick).toHaveBeenCalledWith("a", expect.anything());
    expect(onSelectionChange).toHaveBeenCalledWith(["a"]);
  });

  it("clears the selection when clicking empty canvas", () => {
    const onSelectionChange = vi.fn<(ids: string[]) => void>();
    const { canvas } = renderGraph({ onSelectionChange });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...toClient(-100, 0) }));
    });
    onSelectionChange.mockClear();
    act(() => {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...toClient(0, 250) }));
    });
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it("routes a double-click on a node to onNodeDoubleClick, not the canvas handler", () => {
    const onNodeDoubleClick = vi.fn<(id: string) => void>();
    const onCanvasDoubleClick = vi.fn<(x: number, y: number) => void>();
    const { canvas } = renderGraph({ onNodeDoubleClick, onCanvasDoubleClick });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...toClient(-100, 0) }));
    });
    expect(onNodeDoubleClick).toHaveBeenCalledWith("a", expect.anything());
    expect(onCanvasDoubleClick).not.toHaveBeenCalled();
  });

  it("reports graph coordinates for a double-click on empty canvas", () => {
    const onCanvasDoubleClick = vi.fn<(x: number, y: number) => void>();
    const { canvas } = renderGraph({ onCanvasDoubleClick });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...toClient(50, 250) }));
    });
    const [gx, gy] = onCanvasDoubleClick.mock.calls[0];
    expect(gx).toBeCloseTo(50);
    expect(gy).toBeCloseTo(250);
  });

  it("stops a consumed post-marquee click from activating a parent", () => {
    const parentClick = vi.fn<() => void>();
    const { container } = render(
      <div onClick={parentClick}>
        <GraphCanvas<Data, unknown>
          nodes={nodes}
          edges={edges}
          initialPositions={positions}
          layoutEnabled={false}
          marqueeSelect
        />
      </div>
    );
    const canvas = container.querySelector(".gc-canvas") as HTMLElement;
    act(() => {
      canvas.dispatchEvent(pointerEvt("pointerdown", {
        pointerId: 1,
        clientX: 250,
        clientY: 250,
        button: 0,
        buttons: 1,
      }));
      canvas.dispatchEvent(pointerEvt("pointermove", {
        pointerId: 1,
        clientX: 350,
        clientY: 350,
        button: 0,
        buttons: 1,
      }));
      canvas.dispatchEvent(pointerEvt("pointerup", {
        pointerId: 1,
        clientX: 350,
        clientY: 350,
        button: 0,
        buttons: 0,
      }));
      canvas.dispatchEvent(mouse("click", { clientX: 350, clientY: 350 }));
    });
    expect(parentClick).not.toHaveBeenCalled();
  });
});

describe("GraphCanvas — hover", () => {
  it("reports entering and leaving a node", () => {
    const onNodeHover = vi.fn<(id: string | null) => void>();
    const { canvas } = renderGraph({ onNodeHover });
    act(() => { canvas.dispatchEvent(pointerEvt("pointermove", toClient(-100, 0))); });
    expect(onNodeHover).toHaveBeenCalledWith("a", expect.anything());

    onNodeHover.mockClear();
    act(() => { canvas.dispatchEvent(pointerEvt("pointermove", toClient(0, 250))); });
    expect(onNodeHover).toHaveBeenCalledWith(null, expect.anything());
  });

  it("clears hover when the pointer leaves the canvas", () => {
    const onNodeHover = vi.fn<(id: string | null) => void>();
    const { canvas } = renderGraph({ onNodeHover });
    act(() => { canvas.dispatchEvent(pointerEvt("pointermove", toClient(-100, 0))); });
    onNodeHover.mockClear();
    // React derives onPointerLeave from pointerout with an outside relatedTarget.
    act(() => {
      canvas.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
          relatedTarget: document.body,
        })
      );
    });
    expect(onNodeHover).toHaveBeenCalledWith(null, null);
  });

  it("does not hover-pick nodes hidden underneath chrome", () => {
    const onNodeHover = vi.fn<(id: string | null) => void>();
    const { container, canvas } = renderGraph({ onNodeHover, showMinimap: true });
    act(() => { canvas.dispatchEvent(pointerEvt("pointermove", toClient(-100, 0))); });
    onNodeHover.mockClear();
    const minimap = container.querySelector("[data-gc-minimap]")!;
    act(() => { minimap.dispatchEvent(pointerEvt("pointermove", toClient(-100, 0))); });
    expect(onNodeHover).toHaveBeenCalledWith(null, expect.anything());
  });
});

const renderContextMenu = () => <div data-testid="menu">menu</div>;
const renderInspectableContextMenu = (menu: GraphContextMenuProps<Data, unknown>) => {
  const targetId =
    menu.target.kind === "node"
      ? menu.target.node.id
      : menu.target.kind === "edge"
        ? menu.target.edge.id
        : "";
  return (
    <div
      data-testid="menu"
      data-target-kind={menu.target.kind}
      data-target-id={targetId}
      data-graph-x={menu.graphPosition.x}
      data-graph-y={menu.graphPosition.y}
    />
  );
};

describe("GraphCanvas — context menu", () => {

  it("keeps the native context menu for a portaled overlay control", () => {
    const { container } = renderGraph({
      renderContextMenu,
      children: createPortal(
        <button type="button" data-testid="portal-overlay">overlay</button>,
        document.body
      ),
    });
    const control = document.querySelector('[data-testid="portal-overlay"]') as HTMLElement;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { control.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-testid="menu"]')).toBeNull();
  });

  it("opens a node menu when right-clicking a node", () => {
    const { canvas, container } = renderGraph({ renderContextMenu });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...toClient(-100, 0) }));
    });
    expect(container.querySelector('[data-testid="menu"]')).toBeTruthy();
  });

  it("opens a canvas menu on empty space", () => {
    const { canvas, container } = renderGraph({ renderContextMenu });
    act(() => {
      canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...toClient(0, 250) }));
    });
    expect(container.querySelector('[data-testid="menu"]')).toBeTruthy();
  });

  it("routes a keyboard node menu by semantic id and anchors it to the node", () => {
    const { container } = renderGraph({ renderContextMenu: renderInspectableContextMenu });
    const option = container.querySelector('[data-gc-a11y-node="a"]') as HTMLElement;
    act(() => {
      // Keyboard context-menu events commonly carry no useful pointer point.
      option.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const menu = container.querySelector('[data-testid="menu"]') as HTMLElement;
    expect(menu.dataset.targetKind).toBe("node");
    expect(menu.dataset.targetId).toBe("a");
    expect(menu.dataset.graphX).toBe("-100");
    expect(menu.dataset.graphY).toBe("0");
  });

  it("routes a keyboard edge menu by semantic id and anchors it to the route", () => {
    const { container } = renderGraph({
      edges: linked,
      renderContextMenu: renderInspectableContextMenu,
    });
    const option = container.querySelector('[data-gc-a11y-edge="e1"]') as HTMLElement;
    act(() => {
      option.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const menu = container.querySelector('[data-testid="menu"]') as HTMLElement;
    expect(menu.dataset.targetKind).toBe("edge");
    expect(menu.dataset.targetId).toBe("e1");
    expect(menu.dataset.graphX).toBe("0");
    expect(menu.dataset.graphY).toBe("0");
  });

  it("consumes a semantic edge menu event while its route geometry is pending", () => {
    const pendingEdge: GraphEdge<unknown> = {
      id: "pending",
      source: "a",
      target: "missing",
      data: null,
    };
    const { container } = renderGraph({
      edges: [pendingEdge],
      renderContextMenu: renderInspectableContextMenu,
    });
    const option = container.querySelector('[data-gc-a11y-edge="pending"]') as HTMLElement;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { option.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    // It must not bubble into the canvas handler and become a menu at (0, 0).
    expect(container.querySelector('[data-testid="menu"]')).toBeNull();
  });

  it("renders no menu when the consumer supplies none", () => {
    const { canvas, container } = renderGraph();
    act(() => {
      canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...toClient(0, 250) }));
    });
    expect(container.querySelector("[data-gc-context-menu]")).toBeNull();
  });
});

describe("GraphCanvas — imperative handle", () => {
  it("exposes fitToView, panTo and panToNode", () => {
    const ref = createRef<GraphCanvasRef>();
    renderGraph({ graphRef: ref });
    expect(typeof ref.current?.fitToView).toBe("function");
    expect(typeof ref.current?.panTo).toBe("function");
    expect(typeof ref.current?.panToNode).toBe("function");
  });

  it("panToNode is a silent no-op for an unknown id", () => {
    const ref = createRef<GraphCanvasRef>();
    renderGraph({ graphRef: ref });
    expect(() => act(() => { ref.current?.panToNode("ghost"); })).not.toThrow();
  });

  it("fitToView runs without throwing", () => {
    const ref = createRef<GraphCanvasRef>();
    renderGraph({ graphRef: ref });
    expect(() => act(() => { ref.current?.fitToView(); })).not.toThrow();
  });

  it("fitToView includes a node whose id is a prototype property", () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<GraphCanvasRef>();
      const unusualPositions = Object.create(null) as Record<string, NodePosition>;
      unusualPositions.__proto__ = { x: 0, y: 0 };
      render(
        <GraphCanvas<Data, unknown>
          nodes={[{ id: "__proto__", data: { label: "Prototype" } }]}
          edges={[]}
          initialPositions={unusualPositions}
          layoutEnabled={false}
          graphRef={ref}
        />
      );
      act(() => {
        ref.current?.fitToView();
        vi.runOnlyPendingTimers();
      });
      expect(ref.current?.getZoom()).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GraphCanvas — optional chrome", () => {
  it("shows the fit button by default and hides it on request", () => {
    const { container } = renderGraph();
    expect(container.querySelector("[data-gc-chrome]")).toBeTruthy();
    cleanup();
    const { container: bare } = renderGraph({ showFitView: false });
    expect(bare.querySelector("[data-gc-chrome]")).toBeNull();
  });

  it("mounts the minimap only when asked", () => {
    const { container } = renderGraph();
    expect(container.querySelector("[data-gc-minimap]")).toBeNull();
    cleanup();
    const { container: withMap } = renderGraph({ showMinimap: true });
    expect(withMap.querySelector("[data-gc-minimap]")).toBeTruthy();
  });

  it("renders consumer overlay children", () => {
    const { container } = renderGraph({ children: <div data-testid="overlay" /> });
    expect(container.querySelector('[data-testid="overlay"]')).toBeTruthy();
  });
});

describe("GraphCanvas — positions reporting", () => {
  it("reports only positions for nodes that still exist", () => {
    const onPositionsChange = vi.fn<(p: Record<string, NodePosition>) => void>();
    renderGraph({
      onPositionsChange,
      initialPositions: { ...positions, ghost: { x: 9, y: 9 } },
    });
    const last = onPositionsChange.mock.calls.at(-1)?.[0] ?? {};
    expect(last.ghost).toBeUndefined();
  });
});
