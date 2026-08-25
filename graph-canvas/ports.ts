import type {
  GraphNode,
  NodePosition,
  NodeSize,
  PortDef,
  PortHandleParts,
  PortMode,
  PortSide,
} from "./types.js";
import { DEFAULT_NODE_RADIUS } from "./constants.js";

/** Fallback box used when no `getNodeSize` is supplied.
 *  Derived from the node radius both default renderers draw at, so ports on a
 *  default node sit on its rim rather than floating off a larger phantom box. */
export const DEFAULT_NODE_SIZE: NodeSize = {
  width: DEFAULT_NODE_RADIUS * 2,
  height: DEFAULT_NODE_RADIUS * 2,
};

/** Radius of a port's hit area in graph-space pixels. */
export const PORT_HIT_RADIUS = 12;

/** Edge length of a port glyph in graph-space pixels — the diameter of a
 *  circle port, or the side of the square that becomes a diamond when rotated.
 *  Shared by the HTML layer, the Canvas layer and the anchor math so the drawn
 *  glyph and the point an edge attaches to cannot drift apart. */
export const PORT_SIZE = 12;

/** Width of the thin bar glyph drawn for main input ports, in graph-space pixels.
 *  Gives the arrowhead a flat perpendicular face to butt against instead of a
 *  curved circle rim, so the join reads flush at every zoom level. */
export const PORT_BAR_WIDTH = 4;
/** Height of the bar glyph. Taller than the circle diameter so it reads as a
 *  clear target against the node edge. */
export const PORT_BAR_HEIGHT = PORT_SIZE + 4; // 16

/** Which shape is drawn for a port glyph.
 *  - `circle`  — main output ports (right side)
 *  - `bar`     — main input ports (left side); gives a flat face for arrowheads
 *  - `diamond` — every other type */
export type PortGlyph = "circle" | "diamond" | "bar";

/** Return the glyph shape for a port. */
export function getPortGlyph(port: PortDef): PortGlyph {
  if (port.type !== MAIN_PORT_TYPE) return "diamond";
  return port.mode === "input" ? "bar" : "circle";
}

/** The connection type reserved for primary data flow. Ports of this type sit on
 *  the left/right edges; every other type sits on the bottom/top. */
export const MAIN_PORT_TYPE = "main";

const HANDLE_SEPARATOR = "/";

// ─── Handle id codec ─────────────────────────────────────────────────────────
// Ports are addressed by an encoded string so a single opaque id can carry
// mode + type + ordinal, encoded as `{mode}/{type}/{index}`:
// it keeps `GraphEdge.sourcePort`/`targetPort` as plain strings while still
// letting validation reduce to "parse both ends, compare".

/** Build a stable port id from its parts, e.g. `outputs/main/0`. */
export function createPortHandleId({ mode, type, index }: PortHandleParts): string {
  return [modeToSegment(mode), type, index].join(HANDLE_SEPARATOR);
}

/** Parse a port id back into its parts. Malformed input degrades to the
 *  primary output port rather than throwing, so a stale or hand-written id can
 *  never crash a render. */
export function parsePortHandleId(handleId: string | undefined): PortHandleParts {
  const [modeSegment, type, indexSegment] = (handleId ?? "").split(HANDLE_SEPARATOR);
  const parsedIndex = Number(indexSegment);
  return {
    mode: modeSegment === "inputs" ? "input" : "output",
    type: type || MAIN_PORT_TYPE,
    index: Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0,
  };
}

function modeToSegment(mode: PortMode): string {
  return mode === "input" ? "inputs" : "outputs";
}

// ─── Port defaults ───────────────────────────────────────────────────────────

/** Which edge of the node a port sits on when it doesn't say.
 *  `main` flows left-to-right; every other type hangs off the bottom (inputs)
 *  or the top (outputs), which is what gives AI sub-node graphs their shape. */
export function getPortSide(port: PortDef): PortSide {
  if (port.side) return port.side;
  if (port.type === MAIN_PORT_TYPE) {
    return port.mode === "input" ? "left" : "right";
  }
  return port.mode === "input" ? "bottom" : "top";
}

// ─── Port layout ─────────────────────────────────────────────────────────────

/**
 * Resolve every port on a node to a graph-space point on its bounding box.
 *
 * Ports are grouped by side and distributed evenly along it, so a node with
 * three bottom ports gets them at 25% / 50% / 75% of its width. `position` is
 * the node's centre (the same convention `NodeLayer` uses via
 * `translate(-50%, -50%)`), so a port's offset is measured from there.
 */
export function getPortPositions(
  position: NodePosition,
  size: NodeSize,
  ports: readonly PortDef[]
): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();
  if (ports.length === 0) return result;

  // Group first so each side can space its own ports independently.
  const bySide = new Map<PortSide, PortDef[]>();
  for (const port of ports) {
    const side = getPortSide(port);
    const bucket = bySide.get(side);
    if (bucket) bucket.push(port);
    else bySide.set(side, [port]);
  }

  const halfW = size.width / 2;
  const halfH = size.height / 2;

  for (const [side, sidePorts] of bySide) {
    const isHorizontal = side === "top" || side === "bottom";
    const span = isHorizontal ? size.width : size.height;
    // n+1 gaps for n ports keeps them centred with even margins at both ends.
    const step = span / (sidePorts.length + 1);

    for (let i = 0; i < sidePorts.length; i++) {
      const offset = step * (i + 1) - span / 2;
      result.set(
        sidePorts[i].id,
        isHorizontal
          ? { x: position.x + offset, y: position.y + (side === "top" ? -halfH : halfH) }
          : { x: position.x + (side === "left" ? -halfW : halfW), y: position.y + offset }
      );
    }
  }

  return result;
}

/** Position of a single port, or null when the node has no such port. */
export function getPortPosition(
  position: NodePosition,
  size: NodeSize,
  ports: readonly PortDef[],
  portId: string
): NodePosition | null {
  return getPortPositions(position, size, ports).get(portId) ?? null;
}

// ─── Edge attachment ─────────────────────────────────────────────────────────

/** Unit vector pointing away from the node, for the side a port sits on. */
export function getPortNormal(side: PortSide): NodePosition {
  switch (side) {
    case "left": return { x: -1, y: 0 };
    case "right": return { x: 1, y: 0 };
    case "top": return { x: 0, y: -1 };
    case "bottom": return { x: 0, y: 1 };
  }
}

/**
 * How far past its centre a port's glyph extends, along the outward normal.
 *
 * A `main` port is drawn as a circle, so that's simply its radius. Every other
 * type is drawn as a square rotated 45°, where the outward-facing feature is a
 * *vertex*, not a flat edge — so the distance is the half-diagonal. Using the
 * radius there would leave the edge terminating inside the diamond.
 */
export function getPortExtent(port: PortDef): number {
  if (port.anchorOffset !== undefined) return port.anchorOffset;
  const glyph = getPortGlyph(port);
  if (glyph === "bar") return PORT_BAR_WIDTH / 2;
  if (glyph === "diamond") return (PORT_SIZE * Math.SQRT2) / 2;
  return PORT_SIZE / 2; // circle
}

/**
 * Where an edge should meet a port: its outer tip rather than its centre.
 *
 * Anchoring at the centre draws the first stretch of the edge underneath the
 * glyph, which reads as a line emerging from nowhere. Only edge geometry uses
 * this — the drawn glyph, the spatial hit-box and the drag snap target all stay
 * centred on the port, which is what makes it feel like a target.
 */
export function getPortAnchor(
  position: NodePosition,
  size: NodeSize,
  ports: readonly PortDef[],
  portId: string
): NodePosition | null {
  const centre = getPortPosition(position, size, ports, portId);
  if (!centre) return null;

  const port = findPort(ports, portId);
  if (!port) return centre;

  const normal = getPortNormal(getPortSide(port));
  const extent = getPortExtent(port);
  return {
    x: centre.x + normal.x * extent,
    y: centre.y + normal.y * extent,
  };
}

// ─── Helpers used by the canvas + interaction layers ─────────────────────────

export function resolveNodeSize<T>(
  node: GraphNode<T>,
  getNodeSize?: (node: GraphNode<T>) => NodeSize
): NodeSize {
  return getNodeSize?.(node) ?? DEFAULT_NODE_SIZE;
}

export function resolveNodePorts<T>(
  node: GraphNode<T>,
  getNodePorts?: (node: GraphNode<T>) => PortDef[]
): PortDef[] {
  return getNodePorts?.(node) ?? [];
}

/** Quantise a coordinate to a grid. A zero/undefined/non-finite grid is a
 *  no-op, so callers can pass the prop straight through. */
export function snapValueToGrid(value: number, grid?: number): number {
  if (!grid || !Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Find a port definition by id. */
export function findPort(ports: readonly PortDef[], portId: string | undefined): PortDef | undefined {
  if (!portId) return undefined;
  return ports.find((port) => port.id === portId);
}
