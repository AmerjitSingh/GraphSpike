import { useEffect, useMemo, useRef } from "react";
import { useRawGraphCanvasStore } from "../store.js";
import { getSeedPositions } from "../layout.js";
import { DEFAULT_NODE_RADIUS } from "../constants.js";
import type { GraphNode, GraphEdge } from "../types.js";

interface UseForceLayoutParams<T, E> {
  nodes: GraphNode<T>[];
  edges: GraphEdge<E>[];
  enabled: boolean;
  linkDistance: number;
  chargeStrength: number;
  getNodeRadius: (node: GraphNode<T>) => number;
}

// Hard caps so the simulation doesn't get prohibitively slow.
const MAX_NODES = 2000;
const MAX_MISSING = 1500;
const DEFAULT_LINK_DISTANCE = 140;
const DEFAULT_CHARGE_STRENGTH = -400;

/** Keep malformed public layout inputs away from D3. Valid values are returned
 * unchanged so normal simulations retain exactly the caller's configuration. */
function resolveLinkDistance(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LINK_DISTANCE;
}

function resolveChargeStrength(value: number): number {
  return Number.isFinite(value) ? value : DEFAULT_CHARGE_STRENGTH;
}

function resolveCollisionRadius(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_NODE_RADIUS;
}

export function useForceLayout<T, E>({
  nodes,
  edges,
  enabled,
  linkDistance,
  chargeStrength,
  getNodeRadius,
}: UseForceLayoutParams<T, E>): void {
  const store = useRawGraphCanvasStore();

  const storeRef = useRef(store);
  storeRef.current = store;
  // Always-current refs so the effect can read the latest arrays/fns
  // without listing them as reactive deps.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const getNodeRadiusRef = useRef(getNodeRadius);
  getNodeRadiusRef.current = getNodeRadius;

  const safeLinkDistance = resolveLinkDistance(linkDistance);
  const safeChargeStrength = resolveChargeStrength(chargeStrength);

  // `[...arr].sort()` rather than `toSorted()`: the spread already makes the
  // sort non-mutating, and this keeps the runtime requirement off ES2023.
  // oxlint-disable unicorn/no-array-sort
  const nodeStructureSignature = useMemo(
    () =>
      JSON.stringify(
        [...nodes]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((node) => [node.id, resolveCollisionRadius(getNodeRadius(node))])
      ),
    [nodes, getNodeRadius]
  );
  const edgeStructureSignature = useMemo(
    () =>
      JSON.stringify(
        [...edges]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((edge) => [edge.id, edge.source, edge.target])
      ),
    [edges]
  );
  // oxlint-enable unicorn/no-array-sort

  useEffect(() => {
    const simNodesSource = nodesRef.current;
    const simEdgesSource = edgesRef.current;
    const resolveRadius = (node: GraphNode<T>) =>
      resolveCollisionRadius(getNodeRadiusRef.current(node));
    if (!enabled || simNodesSource.length === 0) return;

    const state = storeRef.current.getState();
    const existingPositions = state.positions;

    // Find nodes that don't have a position yet.
    const positionedIds = new Set(Object.keys(existingPositions));
    const missingNodes = simNodesSource.filter((n) => !positionedIds.has(n.id));
    if (missingNodes.length === 0) return;

    const seed = getSeedPositions(simNodesSource);

    /** Give every unpositioned node its deterministic seed spot. This is the
     *  fallback for every way the simulation can fail to deliver: without it
     *  those nodes keep no position at all and the graph renders blank. */
    const applySeedPositions = () => {
      const live = storeRef.current.getState().positions;
      const updates = missingNodes
        // Anything already placed — by a later tick, or by the user — keeps
        // the position it has.
        .filter((n) => !live[n.id])
        .map((n) => {
          const p = seed[n.id];
          return { id: n.id, x: p ? p.x : 0, y: p ? p.y : 0 };
        });
      if (updates.length === 0) return;
      storeRef.current.getState().setNodePositions(updates);
    };

    // Bail out with a plain seed layout for very large graphs.
    if (simNodesSource.length > MAX_NODES || missingNodes.length > MAX_MISSING) {
      applySeedPositions();
      return;
    }

    const nodeById = new Map(simNodesSource.map((n) => [n.id, n]));
    const nodeIds = new Set(simNodesSource.map((n) => n.id));

    // Already-positioned nodes are fixed so they don't jump.
    const simNodes = simNodesSource.map((n) => {
      const existing = existingPositions[n.id];
      const pos = existing ?? seed[n.id] ?? { x: 0, y: 0 };
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
      };
    });

    const simLinks = simEdgesSource
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const totalTicks = Math.min(240, Math.max(80, missingNodes.length * 10));

    let worker: Worker;
    try {
      // The explicit `.js` specifier matches the compiled output (tsc never
      // rewrites specifiers), and `new URL(..., import.meta.url)` is the form
      // bundlers key off to emit the worker as its own chunk. `type: "module"`
      // is required either way — the worker imports d3-force.
      worker = new Worker(new URL("./forceWorker.js", import.meta.url), { type: "module" });
    } catch (err) {
      console.warn("graph-canvas: Web Worker unavailable, falling back to seed positions.", err);
      applySeedPositions();
      return;
    }

    // Mark the simulation as a transient position-mutation phase so
    // onPositionsChange only fires once, when the simulation settles.
    storeRef.current.getState().beginTransient();
    let transientEnded = false;
    const endTransient = () => {
      if (transientEnded) return;
      transientEnded = true;
      storeRef.current.getState().endTransient();
    };

    // Hard timeout to prevent leaked workers running indefinitely.
    const timeoutId = setTimeout(() => {
      worker.terminate();
      // A simulation that never reported back has left its nodes unpositioned;
      // seeding them is what keeps the graph visible instead of empty.
      applySeedPositions();
      endTransient();
    }, 30_000);

    // Nodes the simulation is responsible for placing. Ownership is given up
    // as soon as anything else moves a node, so a drag or keyboard nudge
    // during a long simulation isn't undone by the next tick.
    const simOwned = new Set(missingNodes.map((n) => n.id));
    const lastWritten = new Map<string, { x: number; y: number }>();

    const flush = (coordinates: Float32Array) => {
      const live = storeRef.current.getState().positions;
      const updates: { id: string; x: number; y: number }[] = [];
      for (let index = 0; index < simNodes.length; index++) {
        const id = simNodes[index].id;
        if (!simOwned.has(id)) continue;

        // If the live position no longer matches what this simulation last
        // wrote, someone else moved the node — hand it over permanently.
        const written = lastWritten.get(id);
        const current = live[id];
        if (written && current && (current.x !== written.x || current.y !== written.y)) {
          simOwned.delete(id);
          continue;
        }
        // Every node here started with no position at all, so one appearing
        // before this simulation wrote anything came from outside.
        if (!written && current) {
          simOwned.delete(id);
          continue;
        }

        const next = { x: coordinates[index * 2], y: coordinates[index * 2 + 1] };
        // The store is the final guard, but ownership bookkeeping must reject
        // the same write too. Remembering a NaN as `lastWritten` makes the next
        // valid tick look like an external move and permanently drops the node.
        if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue;
        updates.push({ id, ...next });
        lastWritten.set(id, next);
      }
      if (updates.length === 0) return;
      storeRef.current.getState().setNodePositions(updates);
    };

    // Batch ticks: only flush every FLUSH_INTERVAL ticks to reduce DOM updates.
    const FLUSH_INTERVAL = 4;
    let tickCount = 0;
    let latestCoordinates: Float32Array | null = null;

    /** Shared teardown for every failure mode: stop the worker, place the
     *  nodes it never placed, and leave the transient balanced. */
    const failWithSeed = (reason?: unknown) => {
      if (transientEnded) return;
      if (reason !== undefined) {
        console.error("graph-canvas force worker failed:", reason);
      }
      clearTimeout(timeoutId);
      worker.terminate();
      applySeedPositions();
      endTransient();
    };

    // A worker that fails to load or throws at top level never posts a
    // message, so the `error` path is the only signal — previously unhandled,
    // which is what left the graph permanently blank.
    worker.addEventListener("error", (e) => failWithSeed(e.message ?? e));
    worker.addEventListener("messageerror", () => failWithSeed("message could not be deserialised"));

    worker.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "tick") {
        latestCoordinates = msg.updates as Float32Array;
        tickCount++;
        if (tickCount % FLUSH_INTERVAL === 0) {
          flush(latestCoordinates);
        }
      } else if (msg.type === "end") {
        // Flush any remaining buffered coordinates, then drop out of the
        // transient phase so usePositionSync fires onPositionsChange once.
        // A worker can complete normally while returning unusable coordinates
        // (for example Float32 overflow). Seed only nodes whose writes were
        // rejected, preserving every valid simulation/user position.
        if (latestCoordinates) flush(latestCoordinates);
        applySeedPositions();
        clearTimeout(timeoutId);
        worker.terminate();
        endTransient();
      } else if (msg.type === "error") {
        failWithSeed(msg.error);
      }
    });

    worker.postMessage({
      nodes: simNodes,
      edges: simLinks,
      fixedIds: Array.from(positionedIds),
      linkDistance: safeLinkDistance,
      chargeStrength: safeChargeStrength,
      nodeRadii: simNodes.map(n => ({ id: n.id, r: resolveRadius(nodeById.get(n.id)!) })),
      totalTicks,
    });

    return () => {
      clearTimeout(timeoutId);
      worker.terminate();
      endTransient();
    };
  }, [
    enabled,
    safeLinkDistance,
    safeChargeStrength,
    nodeStructureSignature,
    edgeStructureSignature,
  ]);
}
