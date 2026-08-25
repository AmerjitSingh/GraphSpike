// @vitest-environment jsdom
import "./setup.dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { installRecordingCanvas, type RecordingContext } from "./setup.canvas";
import { NodeCanvasLayer } from "../renderers/NodeCanvasLayer";
import { EdgeCanvasLayer } from "../renderers/EdgeCanvasLayer";
import type { GraphEdge, GraphNode, NodePosition, NodeSize, PortDef, Viewport } from "../types";
import { MAIN_PORT_TYPE, getPortAnchor, getPortPosition } from "../ports";

type Data = { label: string; shape?: string };

let ctx: RecordingContext;

beforeEach(() => {
  ctx = installRecordingCanvas();
});
afterEach(() => cleanup());

const identity: Viewport = { x: 0, y: 0, zoom: 1 };
const SIZE = { width: 800, height: 600 };

// ─── NodeCanvasLayer ──────────────────────────────────────────────────────────

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
  { id: "c", data: { label: "C" } },
];
const positions: Record<string, NodePosition> = {
  a: { x: 100, y: 100 },
  b: { x: 300, y: 200 },
  c: { x: 500, y: 300 },
};

function renderNodes(over: Partial<Parameters<typeof NodeCanvasLayer<Data>>[0]> = {}) {
  return render(
    <NodeCanvasLayer<Data>
      nodes={nodes}
      positions={positions}
      viewport={identity}
      {...SIZE}
      getNodeRadius={() => 40}
      selectedNodeIds={[]}
      {...over}
    />
  );
}

describe("NodeCanvasLayer — drawing", () => {
  it("draws one circle per visible unselected node", () => {
    renderNodes();
    expect(ctx.count("arc")).toBe(3);
  });

  it("clears the canvas before each pass", () => {
    renderNodes();
    expect(ctx.count("clearRect")).toBeGreaterThanOrEqual(1);
  });

  it("skips nodes handled by the HTML overlay (selected)", () => {
    renderNodes({ selectedNodeIds: ["a", "b"] });
    expect(ctx.count("arc")).toBe(1);
  });

  it("skips nodes with no position", () => {
    renderNodes({ positions: { a: positions.a } });
    expect(ctx.count("arc")).toBe(1);
  });

  it("labels each node", () => {
    renderNodes();
    const texts = ctx.argsFor("fillText").map((a) => a[0]);
    expect(texts).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });

  it("falls back to the node id when there is no label", () => {
    renderNodes({
      nodes: [{ id: "no-label", data: {} as Data }],
      positions: { "no-label": { x: 100, y: 100 } },
    });
    expect(ctx.argsFor("fillText").map((a) => a[0])).toContain("no-label");
  });

  it("truncates a label that does not fit", () => {
    renderNodes({
      nodes: [{ id: "x", data: { label: "an extremely long node label" } }],
      positions: { x: { x: 100, y: 100 } },
    });
    const texts = ctx.argsFor("fillText").map((a) => String(a[0]));
    expect(texts.some((t) => t.endsWith("..."))).toBe(true);
  });

  it("draws rounded rectangles for rectangle-shaped nodes", () => {
    renderNodes({ getNodeShape: () => "rectangle" });
    // Rect nodes use roundRect (or the arcTo fallback), never arc.
    expect(ctx.count("arc")).toBe(0);
    expect(ctx.count("roundRect") + ctx.count("arcTo")).toBeGreaterThan(0);
  });

  it("reads the shape from node data when no accessor is given", () => {
    renderNodes({
      nodes: [{ id: "r", data: { label: "R", shape: "rectangle" } }],
      positions: { r: { x: 100, y: 100 } },
    });
    expect(ctx.count("arc")).toBe(0);
  });

  it("hands drawing to renderCanvasNode and skips the default when handled", () => {
    const renderCanvasNode = vi.fn<() => boolean>(() => true);
    renderNodes({ renderCanvasNode });
    expect(renderCanvasNode).toHaveBeenCalledTimes(3);
    expect(ctx.count("arc")).toBe(0);
  });

  it("still draws the default when renderCanvasNode declines", () => {
    renderNodes({ renderCanvasNode: () => false });
    expect(ctx.count("arc")).toBe(3);
  });

  it("draws a highlight ring for highlighted nodes", () => {
    renderNodes({ highlightedNodeIds: ["a"] });
    // The ring is an extra arc on top of each node's body.
    expect(ctx.count("arc")).toBe(4);
  });
});

describe("NodeCanvasLayer — ports", () => {
  const PORT_SIZE_BOX: NodeSize = { width: 100, height: 100 };
  const twoPorts: PortDef[] = [
    { id: "in", type: MAIN_PORT_TYPE, mode: "input" },
    { id: "out", type: MAIN_PORT_TYPE, mode: "output" },
  ];
  const withPorts = {
    getNodePorts: () => twoPorts,
    getNodeSize: () => PORT_SIZE_BOX,
  };

  it("draws a glyph for every port on every visible node", () => {
    renderNodes(withPorts);
    // 3 nodes x 1 circle body + (1 bar via roundRect, 1 circle output).
    expect(ctx.count("arc")).toBe(3 + 3);
    expect(ctx.count("roundRect")).toBe(3);
  });

  it("still draws ports when the consumer takes over the node body", () => {
    // Regression: `renderCanvasNode` returning true used to `continue` past
    // the whole port pass, leaving the node's ports invisible — while the
    // spatial index still registered them as live snap targets.
    const renderCanvasNode = vi.fn<() => boolean>(() => true);
    renderNodes({ ...withPorts, renderCanvasNode });

    expect(renderCanvasNode).toHaveBeenCalledTimes(3);
    // No default bodies drawn, but the port glyphs are all there.
    expect(ctx.count("arc")).toBe(3);
    expect(ctx.count("roundRect")).toBe(3);
  });

  it("skips the default body but keeps ports per-node", () => {
    // Only node "a" is taken over; the others keep their default circle.
    const renderCanvasNode = vi.fn<(p: { node: GraphNode<Data> }) => boolean>(({ node }) => node.id === "a");
    renderNodes({ ...withPorts, renderCanvasNode });
    // 2 default bodies + 3 output-port circles.
    expect(ctx.count("arc")).toBe(2 + 3);
  });

  it("lets renderCanvasPort take over a port glyph", () => {
    const renderCanvasPort = vi.fn<() => boolean>(() => true);
    renderNodes({ ...withPorts, renderCanvasPort });
    expect(renderCanvasPort).toHaveBeenCalledTimes(6);
    // Only the three default node bodies remain.
    expect(ctx.count("arc")).toBe(3);
    expect(ctx.count("roundRect")).toBe(0);
  });

  it("draws nothing extra when a node has no ports", () => {
    renderNodes({ getNodePorts: () => [] });
    expect(ctx.count("arc")).toBe(3);
    expect(ctx.count("roundRect")).toBe(0);
  });

  it("repaints when the port config changes identity", () => {
    // The layer reads these through refs, so only a dep can trigger the
    // repaint that makes a change visible.
    const { rerender } = renderNodes(withPorts);
    ctx.reset();
    act(() => {
      rerender(
        <NodeCanvasLayer<Data>
          nodes={nodes}
          positions={positions}
          viewport={identity}
          {...SIZE}
          getNodeRadius={() => 40}
          selectedNodeIds={[]}
          getNodeSize={() => PORT_SIZE_BOX}
          getNodePorts={() => [twoPorts[1]]}
        />
      );
    });
    // Repainted, and with one port per node this time.
    expect(ctx.count("arc")).toBe(3 + 3);
    expect(ctx.count("roundRect")).toBe(0);
  });
});

describe("NodeCanvasLayer — keyboard focus", () => {
  it("rings the focused node so keyboard users can see where they are", () => {
    renderNodes();
    const base = ctx.count("arc");
    ctx.reset();
    renderNodes({ focusedNodeId: "b" });
    expect(ctx.count("arc")).toBe(base + 1);
  });

  it("rings the node a keyboard connect was armed from", () => {
    renderNodes();
    const base = ctx.count("arc");
    ctx.reset();
    renderNodes({ connectFromId: "a" });
    expect(ctx.count("arc")).toBe(base + 1);
  });
});

describe("NodeCanvasLayer — viewport culling", () => {
  it("skips nodes far outside the viewport", () => {
    renderNodes({
      nodes: [...nodes, { id: "far", data: { label: "Far" } }],
      positions: { ...positions, far: { x: 99_999, y: 99_999 } },
    });
    expect(ctx.count("arc")).toBe(3);
  });

  it("still draws a node that only partly overlaps the edge", () => {
    // Centre just off-screen but within its own radius of the boundary.
    renderNodes({
      nodes: [{ id: "edge", data: { label: "E" } }],
      positions: { edge: { x: -20, y: 300 } },
      getNodeRadius: () => 40,
    });
    expect(ctx.count("arc")).toBe(1);
  });

  it("respects a large custom radius when culling", () => {
    // Regression: a fixed margin culled big nodes that were still visible.
    renderNodes({
      nodes: [{ id: "big", data: { label: "B" } }],
      positions: { big: { x: -140, y: 300 } },
      getNodeRadius: () => 200,
    });
    expect(ctx.count("arc")).toBe(1);
  });

  it("draws nothing when the canvas has no size", () => {
    renderNodes({ width: 0, height: 0 });
    expect(ctx.count("arc")).toBe(0);
  });
});

// ─── EdgeCanvasLayer ──────────────────────────────────────────────────────────

const edgeNodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];
const nodeById = new Map(edgeNodes.map((n) => [n.id, n]));
const edgePositions: Record<string, NodePosition> = {
  a: { x: 100, y: 300 },
  b: { x: 500, y: 300 },
};
const edges: GraphEdge<unknown>[] = [
  { id: "e1", source: "a", target: "b", data: null },
];

function renderEdges(over: Partial<Parameters<typeof EdgeCanvasLayer<Data, unknown>>[0]> = {}) {
  return render(
    <EdgeCanvasLayer<Data, unknown>
      edges={edges}
      nodeById={nodeById}
      positions={edgePositions}
      viewport={identity}
      {...SIZE}
      getNodeRadius={() => 20}
      {...over}
    />
  );
}

describe("EdgeCanvasLayer — drawing", () => {
  it("strokes each edge", () => {
    renderEdges();
    expect(ctx.count("stroke")).toBeGreaterThanOrEqual(1);
    expect(ctx.count("moveTo")).toBeGreaterThanOrEqual(1);
  });

  it("draws an arrowhead by default", () => {
    renderEdges();
    // The arrowhead is a filled triangle.
    expect(ctx.count("fill")).toBeGreaterThanOrEqual(1);
  });

  it("omits the arrowhead when the style disables it", () => {
    renderEdges({ getEdgeStyle: () => ({ markerEnd: false }) });
    expect(ctx.count("fill")).toBe(0);
  });

  it("applies a custom stroke style", () => {
    renderEdges({ getEdgeStyle: () => ({ stroke: "#ff0000", strokeWidth: 5 }) });
    expect(ctx.count("stroke")).toBeGreaterThanOrEqual(1);
  });

  it("applies a dash pattern", () => {
    renderEdges({ getEdgeStyle: () => ({ strokeDasharray: "6 3" }) });
    const dashes = ctx.argsFor("setLineDash").map((a) => a[0]);
    expect(dashes.some((d) => Array.isArray(d) && d.length === 2)).toBe(true);
  });

  // SVG's stroke-dasharray accepts commas, whitespace, or both. Only handling
  // spaces made "5,6" parse to NaN, get filtered out, and render solid — a
  // dashed edge silently drawn as a solid one.
  it.each(["5,6", "5, 6", "5 6", "  5   6  "])(
    "parses the dash separator style %j",
    (dasharray) => {
      renderEdges({ getEdgeStyle: () => ({ strokeDasharray: dasharray }) });
      const dashes = ctx.argsFor("setLineDash").map((a) => a[0]);
      expect(dashes.some((d) => Array.isArray(d) && d.length === 2)).toBe(true);
    }
  );

  it("leaves the line solid for an empty dash array", () => {
    renderEdges({ getEdgeStyle: () => ({ strokeDasharray: "" }) });
    const dashes = ctx.argsFor("setLineDash").map((a) => a[0]);
    expect(dashes.every((d) => Array.isArray(d) && d.length === 0)).toBe(true);
  });

  it("draws a bezier for curved routes", () => {
    renderEdges({ getEdgeRoute: () => "curved" });
    expect(ctx.count("bezierCurveTo")).toBeGreaterThanOrEqual(1);
  });

  it("draws a polyline for angled routes", () => {
    renderEdges({ getEdgeRoute: () => "angled" });
    expect(ctx.count("lineTo")).toBeGreaterThan(1);
  });

  it("skips edges whose endpoints are missing", () => {
    renderEdges({ positions: { a: edgePositions.a } });
    expect(ctx.count("moveTo")).toBe(0);
  });

  it("skips edges naming unknown nodes", () => {
    renderEdges({ edges: [{ id: "bad", source: "a", target: "ghost", data: null }] });
    expect(ctx.count("moveTo")).toBe(0);
  });

  it("culls edges outside the viewport", () => {
    renderEdges({
      positions: { a: { x: 90_000, y: 90_000 }, b: { x: 95_000, y: 90_000 } },
    });
    expect(ctx.count("moveTo")).toBe(0);
  });

  it("draws nothing when the canvas has no size", () => {
    renderEdges({ width: 0, height: 0 });
    expect(ctx.count("moveTo")).toBe(0);
  });

  it("thickens a selected edge", () => {
    renderEdges({ selectedEdgeId: "e1" });
    expect(ctx.count("stroke")).toBeGreaterThanOrEqual(1);
  });

  it("thickens a highlighted edge", () => {
    renderEdges({ highlightedEdgeIds: new Set(["e1"]) });
    expect(ctx.count("stroke")).toBeGreaterThanOrEqual(1);
  });
});

// ─── Arrowhead / port join ────────────────────────────────────────────────────
// The arrow meeting its target port flush was chased for several rounds by
// eyeballing screenshots and tuning a fudge constant. These tests pin the
// property in screen pixels so it is verified by running something instead.

const JOIN_SIZE: NodeSize = { width: 200, height: 100 };
const JOIN_PORTS: Record<string, PortDef[]> = {
  src: [{ id: "out", type: MAIN_PORT_TYPE, mode: "output" }],
  dst: [{ id: "in", type: MAIN_PORT_TYPE, mode: "input" }],
};
const joinNodes: GraphNode<Data>[] = [
  { id: "src", data: { label: "S" } },
  { id: "dst", data: { label: "D" } },
];
const joinNodeById = new Map(joinNodes.map((n) => [n.id, n]));
const joinPositions: Record<string, NodePosition> = {
  src: { x: 100, y: 300 },
  dst: { x: 500, y: 300 },
};
const joinResolver = {
  getNodePorts: (n: GraphNode<Data>) => JOIN_PORTS[n.id] ?? [],
  getNodeSize: () => JOIN_SIZE,
};
const joinEdges: GraphEdge<unknown>[] = [
  { id: "pe", source: "src", target: "dst", data: null, sourcePort: "out", targetPort: "in" },
];

/** The arrowhead is the only filled triangle: moveTo, lineTo, lineTo, closePath,
 *  fill. Its first point is the apex. */
function arrowApex(rec: RecordingContext): NodePosition | null {
  const ops = rec.ops();
  for (let i = 0; i + 4 < ops.length; i++) {
    if (
      ops[i] === "moveTo" && ops[i + 1] === "lineTo" && ops[i + 2] === "lineTo" &&
      ops[i + 3] === "closePath" && ops[i + 4] === "fill"
    ) {
      const [x, y] = rec.calls[i].args as number[];
      return { x, y };
    }
  }
  return null;
}

describe("EdgeCanvasLayer — arrowhead meets the target port", () => {
  const cases: Array<[string, Viewport]> = [
    ["identity", { x: 0, y: 0, zoom: 1 }],
    ["zoomed in", { x: -100, y: -200, zoom: 2 }],
    ["zoomed out", { x: 40, y: 30, zoom: 0.5 }],
  ];

  it.each(cases)("sits between the glyph face and the port centre (%s)", (_name, viewport) => {
    render(
      <EdgeCanvasLayer<Data, unknown>
        edges={joinEdges}
        nodeById={joinNodeById}
        positions={joinPositions}
        viewport={viewport}
        {...SIZE}
        getNodeRadius={() => 20}
        portResolver={joinResolver}
      />
    );

    const apex = arrowApex(ctx);
    expect(apex).not.toBeNull();

    const face = getPortAnchor(joinPositions.dst, JOIN_SIZE, JOIN_PORTS.dst, "in")!;
    const centre = getPortPosition(joinPositions.dst, JOIN_SIZE, JOIN_PORTS.dst, "in")!;
    const toScreenX = (gx: number) => gx * viewport.zoom + viewport.x;

    // No daylight: the apex never stops short of the glyph's outer face. This is
    // the regression the screenshots kept showing.
    expect(apex!.x).toBeGreaterThanOrEqual(toScreenX(face.x) - 1e-6);
    // Never buried past the port centre, or the head is swallowed by the glyph.
    expect(apex!.x).toBeLessThanOrEqual(toScreenX(centre.x) + 1e-6);
    expect(apex!.y).toBeCloseTo(centre.y * viewport.zoom + viewport.y, 6);
  });

  it("keeps at least half the arrowhead outside the glyph", () => {
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    render(
      <EdgeCanvasLayer<Data, unknown>
        edges={joinEdges}
        nodeById={joinNodeById}
        positions={joinPositions}
        viewport={viewport}
        {...SIZE}
        getNodeRadius={() => 20}
        portResolver={joinResolver}
      />
    );

    const apex = arrowApex(ctx)!;
    const face = getPortAnchor(joinPositions.dst, JOIN_SIZE, JOIN_PORTS.dst, "in")!;
    // arrowSize is max(4, 7 * zoom); half of it is the most we ever bury.
    const arrowSize = Math.max(4, 7 * viewport.zoom);
    expect(apex.x - face.x * viewport.zoom - viewport.x).toBeLessThanOrEqual(arrowSize / 2 + 1e-6);
  });

  it("does not offset the apex when the edge names no port", () => {
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    render(
      <EdgeCanvasLayer<Data, unknown>
        edges={[{ id: "np", source: "src", target: "dst", data: null }]}
        nodeById={joinNodeById}
        positions={joinPositions}
        viewport={viewport}
        {...SIZE}
        getNodeRadius={() => 20}
        portResolver={joinResolver}
      />
    );

    // Falls back to the circular perimeter, so the apex is exactly the anchor.
    const apex = arrowApex(ctx)!;
    expect(apex.x).toBeCloseTo(joinPositions.dst.x - 20, 6);
  });
});

describe("EdgeCanvasLayer — interaction", () => {
  it("reports a click on an edge", () => {
    const onEdgeClick = vi.fn<(id: string) => void>();
    const { container } = renderEdges({ onEdgeClick });
    const canvas = container.querySelector("canvas")!;
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })
      );
    });
    expect(onEdgeClick).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("ignores clicks that miss every edge", () => {
    const onEdgeClick = vi.fn<(id: string) => void>();
    const { container } = renderEdges({ onEdgeClick });
    const canvas = container.querySelector("canvas")!;
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 50 })
      );
    });
    expect(onEdgeClick).not.toHaveBeenCalled();
  });

  it("reports a context-menu on an edge", () => {
    const onEdgeContextMenu = vi.fn<(id: string) => void>();
    const { container } = renderEdges({ onEdgeContextMenu });
    const canvas = container.querySelector("canvas")!;
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })
      );
    });
    expect(onEdgeContextMenu).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("does not hit-test when non-interactive", () => {
    const onEdgeClick = vi.fn<(id: string) => void>();
    const { container } = renderEdges({ onEdgeClick, interactive: false });
    const canvas = container.querySelector("canvas")!;
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })
      );
    });
    expect(onEdgeClick).not.toHaveBeenCalled();
  });
});
