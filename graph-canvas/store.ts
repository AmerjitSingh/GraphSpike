/**
 * Internal Zustand store for GraphCanvas2.
 *
 * Uses `zustand/vanilla` + React context so each <GraphCanvas> instance
 * has its own isolated state — multiple graphs on the same page don't
 * share positions or selection.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import type { NodePosition, Viewport } from "./types.js";

// ─── State shape ─────────────────────────────────────────────────────────────

export interface GraphCanvasState {
  /** Graph-space positions keyed by node id */
  positions: Record<string, NodePosition>;
  /** Current pan / zoom */
  viewport: Viewport;
  /** Currently selected node ids */
  selectedNodeIds: string[];
  /**
   * Non-zero while positions are being mutated transiently (force simulation
   * in progress, node drag in flight). Consumers of `onPositionsChange`
   * should only be notified when this returns to zero — the committed state.
   */
  transientDepth: number;

  // ── Actions
  setNodePosition: (id: string, x: number, y: number) => void;
  setNodePositions: (updates: { id: string; x: number; y: number }[]) => void;
  setViewport: (viewport: Viewport) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  /** Remove positions / selection entries for nodes that no longer exist. */
  pruneToNodes: (ids: string[]) => void;
  /** Mark the start of a transient position-mutation phase. */
  beginTransient: () => void;
  /** Mark the end of a transient phase. When depth drops to 0, any
   *  pending `onPositionsChange` notification will be flushed. */
  endTransient: () => void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export type GraphCanvasStore = StoreApi<GraphCanvasState>;

/**
 * A position record with no prototype.
 *
 * Node ids come from the consumer's data, so `"constructor"`, `"toString"` and
 * `"__proto__"` are all legal ids. On a normal object `positions["constructor"]`
 * returns a truthy inherited function, so every `if (positions[id])` presence
 * test in the library would silently mis-answer for those nodes. Building the
 * record without a prototype makes the plain lookups callers already write
 * correct, rather than requiring `Object.hasOwn` at nineteen call sites.
 */
export function emptyPositions(): Record<string, NodePosition> {
  return Object.create(null) as Record<string, NodePosition>;
}

/** Copy a position record, preserving the null prototype. */
function clonePositions(positions: Record<string, NodePosition>): Record<string, NodePosition> {
  return Object.assign(emptyPositions(), positions);
}

/** True when x and y are both real numbers. */
function isFinitePoint(p: NodePosition | undefined): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Drop coordinates that aren't finite numbers.
 *
 *  A single NaN spreads: it reaches the spatial index (poisoning bounds
 *  comparisons), the edge geometry, and `fitToView`, where one bad node makes
 *  the whole viewport transform NaN and the graph disappears. Cheaper to
 *  refuse it at the door than to guard every consumer of a position. */
export function filterFinitePositions(
  positions: Record<string, NodePosition>
): Record<string, NodePosition> {
  const result = emptyPositions();
  for (const [id, p] of Object.entries(positions)) {
    // Clone the point as well as the outer record. Otherwise a caller can
    // mutate its original seed after mount and inject NaN/Infinity directly
    // into live state without going through either guarded setter.
    if (isFinitePoint(p)) result[id] = { x: p.x, y: p.y };
  }
  return result;
}

export function createGraphCanvasStore(
  initialPositions: Record<string, NodePosition> = {}
): GraphCanvasStore {
  return createStore<GraphCanvasState>((set) => ({
    // `usePositionSync` validates later seeds, but this one goes straight into
    // the store on mount and would otherwise skip that check entirely.
    positions: filterFinitePositions(initialPositions),
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: [],
    transientDepth: 0,

    beginTransient: () =>
      set((s) => ({ transientDepth: s.transientDepth + 1 })),
    endTransient: () =>
      set((s) => ({ transientDepth: Math.max(0, s.transientDepth - 1) })),

    // Two guards on every write, not just the initial seed.
    //
    // Non-finite coordinates are refused outright: one NaN reaching the spatial
    // index or fitToView turns the whole viewport transform into NaN and the
    // graph vanishes.
    //
    // A write that changes nothing returns the same state object. The record is
    // cloned wholesale on every write, and a new identity re-renders the canvas,
    // repatches the spatial index and rescans the edge geometry cache — all O(n)
    // work. A snapped drag resolves most pointer moves to the coordinates
    // already stored, so without this the common case is a full graph update per
    // frame for a node that did not move.
    setNodePosition: (id, x, y) =>
      set((s) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return s;
        const current = s.positions[id];
        if (current && current.x === x && current.y === y) return s;
        const next = clonePositions(s.positions);
        next[id] = { x, y };
        return { positions: next };
      }),

    setNodePositions: (updates) =>
      set((s) => {
        // Cloned lazily, so a batch where every entry is a no-op costs nothing.
        let next: Record<string, NodePosition> | null = null;
        for (const { id, x, y } of updates) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          // Read from the clone once it exists, so a batch naming the same id
          // twice compares against the write already applied.
          const current = (next ?? s.positions)[id];
          if (current && current.x === x && current.y === y) continue;
          if (!next) next = clonePositions(s.positions);
          next[id] = { x, y };
        }
        return next ? { positions: next } : s;
      }),

    setViewport: (viewport) => set({ viewport }),

    setSelection: (ids) =>
      set((s) => {
        const oldSet = new Set(s.selectedNodeIds);
        const newSet = new Set(ids);
        if (oldSet.size === newSet.size) {
          let identical = true;
          for (const id of newSet) {
            if (!oldSet.has(id)) { identical = false; break; }
          }
          if (identical) return s;
        }
        return { selectedNodeIds: [...newSet] };
      }),

    toggleSelection: (id) =>
      set((s) => ({
        selectedNodeIds: s.selectedNodeIds.includes(id)
          ? s.selectedNodeIds.filter((x) => x !== id)
          : [...s.selectedNodeIds, id],
      })),

    clearSelection: () =>
      set((s) => (s.selectedNodeIds.length === 0 ? s : { selectedNodeIds: [] })),

    pruneToNodes: (ids) =>
      set((s) => {
        const validIds = new Set(ids);

        let positionsChanged = false;
        const nextPositions = emptyPositions();
        for (const [id, position] of Object.entries(s.positions)) {
          if (validIds.has(id)) {
            nextPositions[id] = position;
          } else {
            positionsChanged = true;
          }
        }

        const nextSelection = s.selectedNodeIds.filter((id) => validIds.has(id));
        const selectionChanged = nextSelection.length !== s.selectedNodeIds.length;

        if (!positionsChanged && !selectionChanged) return s;

        return {
          positions: positionsChanged ? nextPositions : s.positions,
          selectedNodeIds: selectionChanged ? nextSelection : s.selectedNodeIds,
        };
      }),
  }));
}

// ─── Context + hook ───────────────────────────────────────────────────────────

export const GraphCanvasStoreContext = createContext<GraphCanvasStore | null>(null);

export function useGraphCanvasStore<U>(selector: (state: GraphCanvasState) => U): U {
  const store = useContext(GraphCanvasStoreContext);
  if (!store) throw new Error("useGraphCanvasStore must be used within <GraphCanvas>");
  return useStore(store, selector);
}

/** Escape-hatch: read the raw store ref from context (for use in callbacks). */
export function useRawGraphCanvasStore(): GraphCanvasStore {
  const store = useContext(GraphCanvasStoreContext);
  if (!store) throw new Error("useRawGraphCanvasStore must be used within <GraphCanvas>");
  return store;
}
