import { describe, it, expect } from "vitest";
import {
  createPortHandleId,
  parsePortHandleId,
  getPortPositions,
  getPortPosition,
  getPortAnchor,
  getPortExtent,
  getPortNormal,
  getPortSide,
  findPort,
  snapValueToGrid,
  resolveNodeSize,
  resolveNodePorts,
  DEFAULT_NODE_SIZE,
  MAIN_PORT_TYPE,
  PORT_BAR_WIDTH,
  PORT_SIZE,
} from "../ports";
import type { GraphNode, NodeSize, PortDef } from "../types";

const SIZE: NodeSize = { width: 200, height: 100 };

function port(over: Partial<PortDef> & Pick<PortDef, "id">): PortDef {
  return { type: MAIN_PORT_TYPE, mode: "output", ...over };
}

// ─── Handle id codec ─────────────────────────────────────────────────────────

describe("port handle id codec", () => {
  it("round-trips every part", () => {
    const parts = { mode: "input", type: "ai_memory", index: 3 } as const;
    expect(parsePortHandleId(createPortHandleId(parts))).toEqual(parts);
  });

  it("encodes mode as a plural segment", () => {
    expect(createPortHandleId({ mode: "input", type: "main", index: 0 })).toBe("inputs/main/0");
    expect(createPortHandleId({ mode: "output", type: "main", index: 2 })).toBe("outputs/main/2");
  });

  it.each([
    ["", "empty"],
    ["garbage", "no separators"],
    ["outputs", "mode only"],
    ["nonsense/main/0", "unknown mode"],
  ])("degrades malformed input (%s — %s) to the primary output port", (input) => {
    expect(parsePortHandleId(input)).toEqual({ mode: "output", type: "main", index: 0 });
  });

  it("treats a missing id as the primary output port", () => {
    expect(parsePortHandleId(undefined)).toEqual({ mode: "output", type: "main", index: 0 });
  });

  it("falls back to index 0 for a non-numeric or negative index", () => {
    expect(parsePortHandleId("inputs/tool/abc").index).toBe(0);
    expect(parsePortHandleId("inputs/tool/-2").index).toBe(0);
  });

  it("keeps a valid index and type even when the mode is junk", () => {
    // Only the mode should degrade — the rest of the id is still usable.
    expect(parsePortHandleId("xxx/tool/4")).toEqual({ mode: "output", type: "tool", index: 4 });
  });
});

// ─── Default sides ───────────────────────────────────────────────────────────

describe("getPortSide", () => {
  it("flows main connections left to right", () => {
    expect(getPortSide(port({ id: "i", mode: "input" }))).toBe("left");
    expect(getPortSide(port({ id: "o", mode: "output" }))).toBe("right");
  });

  it("hangs non-main connections off the bottom (in) and top (out)", () => {
    expect(getPortSide(port({ id: "i", type: "model", mode: "input" }))).toBe("bottom");
    expect(getPortSide(port({ id: "o", type: "model", mode: "output" }))).toBe("top");
  });

  it("honours an explicit side over the default", () => {
    expect(getPortSide(port({ id: "o", mode: "output", side: "bottom" }))).toBe("bottom");
  });
});

// ─── Layout ──────────────────────────────────────────────────────────────────

describe("getPortPositions", () => {
  const centre = { x: 0, y: 0 };

  it("returns nothing for a node with no ports", () => {
    expect(getPortPositions(centre, SIZE, []).size).toBe(0);
  });

  it("centres a single port on its side", () => {
    const ports = [port({ id: "m", type: "model", mode: "input" })]; // bottom
    expect(getPortPositions(centre, SIZE, ports).get("m")).toEqual({ x: 0, y: 50 });
  });

  it("spaces n ports across n+1 gaps, keeping equal end margins", () => {
    const ports = [
      port({ id: "a", type: "model", mode: "input" }),
      port({ id: "b", type: "model", mode: "input" }),
      port({ id: "c", type: "model", mode: "input" }),
    ];
    const result = getPortPositions(centre, SIZE, ports);
    // width 200, 4 gaps of 50 → -50, 0, +50 relative to centre
    expect(result.get("a")).toEqual({ x: -50, y: 50 });
    expect(result.get("b")).toEqual({ x: 0, y: 50 });
    expect(result.get("c")).toEqual({ x: 50, y: 50 });
  });

  it("spaces vertical sides along height, not width", () => {
    const ports = [
      port({ id: "a", mode: "input" }),
      port({ id: "b", mode: "input" }),
    ]; // left side, height 100 → 3 gaps of ~33.3
    const result = getPortPositions(centre, SIZE, ports);
    expect(result.get("a")!.x).toBe(-100);
    expect(result.get("b")!.x).toBe(-100);
    expect(result.get("a")!.y).toBeCloseTo(-100 / 6, 5);
    expect(result.get("b")!.y).toBeCloseTo(100 / 6, 5);
  });

  it("spaces each side independently", () => {
    const ports = [
      port({ id: "in", mode: "input" }),   // left
      port({ id: "out", mode: "output" }), // right
    ];
    const result = getPortPositions(centre, SIZE, ports);
    // One port per side, so both sit at the vertical centre.
    expect(result.get("in")).toEqual({ x: -100, y: 0 });
    expect(result.get("out")).toEqual({ x: 100, y: 0 });
  });

  it("offsets from the node position rather than the origin", () => {
    const ports = [port({ id: "o", mode: "output" })];
    expect(getPortPositions({ x: 500, y: -20 }, SIZE, ports).get("o")).toEqual({ x: 600, y: -20 });
  });

  it("getPortPosition returns null for an unknown port id", () => {
    const ports = [port({ id: "o" })];
    expect(getPortPosition(centre, SIZE, ports, "nope")).toBeNull();
    expect(getPortPosition(centre, SIZE, ports, "o")).not.toBeNull();
  });
});

// ─── Edge attachment ─────────────────────────────────────────────────────────

describe("getPortNormal", () => {
  it("points away from the node on every side", () => {
    expect(getPortNormal("left")).toEqual({ x: -1, y: 0 });
    expect(getPortNormal("right")).toEqual({ x: 1, y: 0 });
    expect(getPortNormal("top")).toEqual({ x: 0, y: -1 });
    expect(getPortNormal("bottom")).toEqual({ x: 0, y: 1 });
  });
});

describe("getPortExtent", () => {
  it("uses the radius for a circular main port", () => {
    expect(getPortExtent(port({ id: "o" }))).toBe(PORT_SIZE / 2);
  });

  // The two main modes are deliberately asymmetric: an output is a circle, but
  // an input is a thin bar so an incoming arrowhead has a flat perpendicular
  // face to meet instead of a curved rim.
  it("uses half the bar width for a main input port", () => {
    expect(getPortExtent(port({ id: "i", mode: "input" }))).toBe(PORT_BAR_WIDTH / 2);
  });

  it("gives main inputs a smaller extent than main outputs", () => {
    expect(getPortExtent(port({ id: "i", mode: "input" }))).toBeLessThan(
      getPortExtent(port({ id: "o", mode: "output" }))
    );
  });

  it("uses the half-diagonal for a diamond, so the anchor lands on the vertex", () => {
    const extent = getPortExtent(port({ id: "m", type: "model" }));
    expect(extent).toBeCloseTo((PORT_SIZE * Math.SQRT2) / 2, 6);
    // Strictly further out than the radius — that difference is the bug fix.
    expect(extent).toBeGreaterThan(PORT_SIZE / 2);
  });

  it("honours an explicit anchorOffset over the derived extent", () => {
    expect(getPortExtent(port({ id: "m", type: "model", anchorOffset: 3 }))).toBe(3);
    expect(getPortExtent(port({ id: "o", anchorOffset: 0 }))).toBe(0);
  });
});

describe("getPortAnchor", () => {
  const centre = { x: 0, y: 0 };

  it("offsets outward from the port centre, per side", () => {
    // One port per side so each sits at the middle of its edge.
    const cases: Array<[PortDef, { x: number; y: number }]> = [
      // Left is a main input — a bar, so the anchor sits on its flat outer face.
      [port({ id: "l", mode: "input" }), { x: -100 - PORT_BAR_WIDTH / 2, y: 0 }],
      // Right is a main output — still a circle, so the anchor is its radius out.
      [port({ id: "r", mode: "output" }), { x: 100 + PORT_SIZE / 2, y: 0 }],
    ];
    for (const [p, expected] of cases) {
      const anchor = getPortAnchor(centre, SIZE, [p], p.id)!;
      expect(anchor.x).toBeCloseTo(expected.x, 6);
      expect(anchor.y).toBeCloseTo(expected.y, 6);
    }
  });

  it("puts a bottom diamond's anchor below its centre by the half-diagonal", () => {
    const p = port({ id: "m", type: "model", mode: "input" }); // bottom
    const anchor = getPortAnchor(centre, SIZE, [p], "m")!;
    const centrePoint = getPortPosition(centre, SIZE, [p], "m")!;
    expect(anchor.x).toBeCloseTo(centrePoint.x, 6);
    expect(anchor.y).toBeCloseTo(centrePoint.y + (PORT_SIZE * Math.SQRT2) / 2, 6);
  });

  it("puts a top provider port's anchor above its centre", () => {
    const p = port({ id: "provides", type: "model", mode: "output" }); // top
    const anchor = getPortAnchor(centre, SIZE, [p], "provides")!;
    expect(anchor.y).toBeLessThan(getPortPosition(centre, SIZE, [p], "provides")!.y);
  });

  it("never equals the port centre for a default-sized glyph", () => {
    const p = port({ id: "m", type: "model", mode: "input" });
    expect(getPortAnchor(centre, SIZE, [p], "m")).not.toEqual(
      getPortPosition(centre, SIZE, [p], "m")
    );
  });

  it("collapses onto the centre when anchorOffset is 0", () => {
    const p = port({ id: "m", type: "model", mode: "input", anchorOffset: 0 });
    expect(getPortAnchor(centre, SIZE, [p], "m")).toEqual(
      getPortPosition(centre, SIZE, [p], "m")
    );
  });

  it("returns null for an unknown port id", () => {
    expect(getPortAnchor(centre, SIZE, [port({ id: "o" })], "nope")).toBeNull();
  });
});

// ─── Snap to grid ────────────────────────────────────────────────────────────

describe("snapValueToGrid", () => {
  it("quantises to the nearest multiple", () => {
    expect(snapValueToGrid(17, 16)).toBe(16);
    expect(snapValueToGrid(25, 16)).toBe(32);
    expect(snapValueToGrid(-17, 16)).toBe(-16);
  });

  it.each([undefined, 0, -8, NaN, Infinity])("passes through for grid %s", (grid) => {
    expect(snapValueToGrid(17.5, grid as number | undefined)).toBe(17.5);
  });
});

// ─── Resolvers ───────────────────────────────────────────────────────────────

describe("resolvers", () => {
  const node: GraphNode<{ label: string }> = { id: "n", data: { label: "N" } };

  it("falls back to the default box when no size fn is given", () => {
    expect(resolveNodeSize(node)).toEqual(DEFAULT_NODE_SIZE);
    expect(resolveNodeSize(node, () => SIZE)).toEqual(SIZE);
  });

  it("treats a missing port fn as no ports", () => {
    expect(resolveNodePorts(node)).toEqual([]);
  });

  it("findPort tolerates an undefined id", () => {
    const ports = [port({ id: "o" })];
    expect(findPort(ports, undefined)).toBeUndefined();
    expect(findPort(ports, "o")?.id).toBe("o");
  });
});
