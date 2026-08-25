import RBush from "rbush";
import type { GraphNode, NodePosition, PortDef } from "./types.js";
import { getNodeRadius, resolveNodeShape } from "./geometry.js";
import { RECT_H, RECT_W } from "./constants.js";
import { PORT_HIT_RADIUS, getPortPositions, resolveNodePorts, resolveNodeSize } from "./ports.js";

export interface SpatialItem {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PortSpatialItem extends SpatialItem {
  /** `id` is the owning node id; `portId` disambiguates within it. */
  portId: string;
  port: PortDef;
  x: number;
  y: number;
}

export interface PortHit {
  nodeId: string;
  portId: string;
  port: PortDef;
}

/**
 * Per-instance R-tree spatial index over node bounding boxes.
 *
 * Each node is represented as an axis-aligned square centred on its position
 * with half-side equal to its radius.  This allows O(log n + k) rectangular
 * range queries used for:
 *   - drag-to-connect snap detection
 *   - rubber-band selection
 */
export class SpatialIndex<T = unknown> {
  private tree = new RBush<SpatialItem>();
  private boundsById = new Map<string, SpatialItem>();

  // ── Port index ────────────────────────────────────────────────────────────
  // Kept in the same class, and maintained by the same mutators, so a node move
  // can never leave port hit-boxes at stale coordinates.
  private portTree = new RBush<PortSpatialItem>();
  private portsByNode = new Map<string, PortSpatialItem[]>();
  private getNodePorts?: (node: GraphNode<T>) => PortDef[];
  private getNodeSize?: (node: GraphNode<T>) => { width: number; height: number };
  private getNodeShape?: (node: GraphNode<T>) => string;

  /** Enable port hit-testing. Without this the port tree stays empty and
   *  `nearestPort` always returns null. */
  configurePorts(
    getNodePorts: ((node: GraphNode<T>) => PortDef[]) | undefined,
    getNodeSize?: (node: GraphNode<T>) => { width: number; height: number }
  ) {
    this.getNodePorts = getNodePorts;
    this.getNodeSize = getNodeSize;
  }

  /** Make node bounds shape-aware. A change of shape function invalidates
   *  every bound, so the caller must rebuild after reconfiguring. */
  configureShape(getNodeShape?: (node: GraphNode<T>) => string) {
    this.getNodeShape = getNodeShape;
  }

  private buildBounds(
    node: GraphNode<T>,
    position: NodePosition,
    getRadius?: (node: GraphNode<T>) => number
  ): SpatialItem {
    const r = getNodeRadius(node, getRadius);
    let halfW = r;
    let halfH = r;
    // The canvas layer draws a "rectangle" node at a fixed RECT_W×RECT_H
    // regardless of radius, so a radius-square alone misses presses on the
    // outer thirds of the drawn shape. Union with the rectangle rather than
    // replacing the radius: a consumer who already compensated with a larger
    // radius keeps every press that used to land.
    if (resolveNodeShape(node, this.getNodeShape) === "rectangle") {
      halfW = Math.max(halfW, RECT_W / 2);
      halfH = Math.max(halfH, RECT_H / 2);
    }
    return {
      id: node.id,
      minX: position.x - halfW,
      minY: position.y - halfH,
      maxX: position.x + halfW,
      maxY: position.y + halfH,
    };
  }

  /** Remove a node's port entries from the port tree. */
  private clearPorts(nodeId: string) {
    const prev = this.portsByNode.get(nodeId);
    if (!prev) return;
    // Remove by stored reference so RBush can use identity, not a predicate walk.
    for (const item of prev) this.portTree.remove(item);
    this.portsByNode.delete(nodeId);
  }

  /** Recompute and reinsert a node's port entries. */
  private syncPorts(node: GraphNode<T>, position: NodePosition) {
    if (!this.getNodePorts) return;
    this.clearPorts(node.id);

    const ports = resolveNodePorts(node, this.getNodePorts);
    if (ports.length === 0) return;

    const size = resolveNodeSize(node, this.getNodeSize);
    const positions = getPortPositions(position, size, ports);
    const items: PortSpatialItem[] = [];

    for (const port of ports) {
      const p = positions.get(port.id);
      if (!p) continue;
      items.push({
        id: node.id,
        portId: port.id,
        port,
        x: p.x,
        y: p.y,
        minX: p.x - PORT_HIT_RADIUS,
        minY: p.y - PORT_HIT_RADIUS,
        maxX: p.x + PORT_HIT_RADIUS,
        maxY: p.y + PORT_HIT_RADIUS,
      });
    }

    if (items.length === 0) return;
    this.portTree.load(items);
    this.portsByNode.set(node.id, items);
  }

  /** Rebuild the entire index from scratch (called on initial load). */
  rebuild(
    nodes: GraphNode<T>[],
    positions: Record<string, NodePosition>,
    getRadius?: (node: GraphNode<T>) => number
  ) {
    this.tree.clear();
    this.boundsById.clear();
    this.portTree.clear();
    this.portsByNode.clear();
    const items: SpatialItem[] = [];
    for (const node of nodes) {
      const pos = positions[node.id];
      if (!pos) continue;
      const bounds = this.buildBounds(node, pos, getRadius);
      items.push(bounds);
      this.boundsById.set(node.id, bounds);
      this.syncPorts(node, pos);
    }
    if (items.length > 0) this.tree.load(items);
  }

  /** Incrementally update a single node (called on drag). */
  update(
    node: GraphNode<T>,
    position: NodePosition,
    getRadius?: (node: GraphNode<T>) => number
  ) {
    const prev = this.boundsById.get(node.id);
    // Remove by the same object reference we stored — RBush uses reference
    // equality and skips the O(n) predicate walk.
    if (prev) this.tree.remove(prev);
    const next = this.buildBounds(node, position, getRadius);
    this.tree.insert(next);
    this.boundsById.set(node.id, next);
    this.syncPorts(node, position);
  }

  /** Batch-update positions for multiple nodes without a full rebuild. */
  updateBatch(
    nodes: GraphNode<T>[],
    positions: Record<string, NodePosition>,
    getRadius?: (node: GraphNode<T>) => number
  ) {
    for (const node of nodes) {
      const pos = positions[node.id];
      if (!pos) continue;
      const prev = this.boundsById.get(node.id);
      if (prev) this.tree.remove(prev);
      const next = this.buildBounds(node, pos, getRadius);
      this.tree.insert(next);
      this.boundsById.set(node.id, next);
      this.syncPorts(node, pos);
    }
  }

  /** Remove nodes from the index (called on delete). */
  remove(ids: string[]) {
    for (const id of ids) {
      this.clearPorts(id);
      const prev = this.boundsById.get(id);
      if (!prev) continue;
      this.tree.remove(prev);
      this.boundsById.delete(id);
    }
  }

  /** AABB range query — returns all nodes whose bounds intersect the given box. */
  search(bounds: { minX: number; minY: number; maxX: number; maxY: number }): SpatialItem[] {
    return this.tree.search(bounds);
  }

  /** Find the closest node to (px, py) within `maxRadius` graph-space pixels.
   *  Returns null if none found. */
  nearest(
    px: number,
    py: number,
    maxRadius: number,
    exclude?: string
  ): string | null {
    const hits = this.tree.search({
      minX: px - maxRadius,
      minY: py - maxRadius,
      maxX: px + maxRadius,
      maxY: py + maxRadius,
    });
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const item of hits) {
      if (item.id === exclude) continue;
      const cx = (item.minX + item.maxX) / 2;
      const cy = (item.minY + item.maxY) / 2;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = item.id;
      }
    }
    return bestId;
  }

  /** Find the closest port to (px, py) within `maxRadius` graph-space pixels.
   *  `excludeNode` keeps a drag from snapping back onto its own source node.
   *  `accept` filters candidates (used for connection validation), so an
   *  invalid port never becomes the nearest hit and shadows a valid one
   *  slightly further away. */
  nearestPort(
    px: number,
    py: number,
    maxRadius: number,
    excludeNode?: string,
    accept?: (hit: PortHit) => boolean
  ): PortHit | null {
    const hits = this.portTree.search({
      minX: px - maxRadius,
      minY: py - maxRadius,
      maxX: px + maxRadius,
      maxY: py + maxRadius,
    });
    let best: PortHit | null = null;
    let bestDist = Infinity;
    for (const item of hits) {
      if (item.id === excludeNode) continue;
      const dist = Math.hypot(px - item.x, py - item.y);
      if (dist > maxRadius || dist >= bestDist) continue;
      const candidate: PortHit = { nodeId: item.id, portId: item.portId, port: item.port };
      if (accept && !accept(candidate)) continue;
      bestDist = dist;
      best = candidate;
    }
    return best;
  }

  /** Pick a node under a point. First checks nodes whose bbox contains the
   *  point (the "correct" hit for large nodes), then falls back to the nearest
   *  node centre within `tolerance`. Returns null if no match. */
  pickAt(px: number, py: number, tolerance: number, exclude?: string): string | null {
    const containing = this.tree.search({ minX: px, minY: py, maxX: px, maxY: py });
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const item of containing) {
      if (item.id === exclude) continue;
      const cx = (item.minX + item.maxX) / 2;
      const cy = (item.minY + item.maxY) / 2;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = item.id;
      }
    }
    if (bestId) return bestId;
    return this.nearest(px, py, tolerance, exclude);
  }
}
