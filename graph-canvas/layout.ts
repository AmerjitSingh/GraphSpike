import type { GraphNode, NodePosition } from "./types.js";

const BASE_RING_GAP = 180; // px between ring radii
const MIN_SPACING = 120;   // min arc-length between nodes on a ring

/**
 * Compute deterministic seed positions for every node.
 *
 * Nodes are sorted by id (stable across sessions) and placed on
 * concentric rings so the force simulation always starts from a
 * sensible spread rather than a collapsed heap.
 *
 * If there is only one node it is placed at the origin.
 */
export function getSeedPositions<T>(
  nodes: GraphNode<T>[]
): Record<string, NodePosition> {
  // Node ids are consumer data. A normal object treats `"__proto__"` as a
  // prototype setter, so that legal id would disappear from Object.keys/
  // Object.entries and could not be fed back as an initial-position record.
  const positions = Object.create(null) as Record<string, NodePosition>;
  if (nodes.length === 0) return positions;

  // Spread first, so this is non-mutating without needing ES2023's toSorted().
  // oxlint-disable-next-line unicorn/no-array-sort
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  if (sorted.length === 1) {
    positions[sorted[0].id] = { x: 0, y: 0 };
    return positions;
  }

  let placed = 0;
  let ring = 1;

  while (placed < sorted.length) {
    const radius = ring * BASE_RING_GAP;
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * radius) / MIN_SPACING));
    const inRing = Math.min(capacity, sorted.length - placed);
    const step = (Math.PI * 2) / inRing;
    // Alternate start angle between rings so nodes don't radially align.
    const startAngle = ring % 2 === 0 ? -Math.PI / 2 + step / 2 : -Math.PI / 2;

    for (let i = 0; i < inRing; i++) {
      const angle = startAngle + i * step;
      positions[sorted[placed + i].id] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    }

    placed += inRing;
    ring++;
  }

  return positions;
}
