"use client";
import { useEffect, useRef } from "react";
import { useGraphCanvasStore, useRawGraphCanvasStore } from "../store.js";
import type { GraphNode, NodePosition } from "../types.js";

interface UsePositionSyncProps<T> {
  nodes: GraphNode<T>[];
  initialPositions: Record<string, NodePosition>;
  onPositionsChange?: (positions: Record<string, NodePosition>) => void;
}

function havePositionsChanged(
  previous: Record<string, NodePosition> | null,
  next: Record<string, NodePosition>
): boolean {
  if (!previous) return true;

  const previousIds = Object.keys(previous);
  const nextIds = Object.keys(next);
  if (previousIds.length !== nextIds.length) return true;

  for (const id of nextIds) {
    const previousPosition = previous[id];
    const nextPosition = next[id];
    if (
      !previousPosition ||
      previousPosition.x !== nextPosition.x ||
      previousPosition.y !== nextPosition.y
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Notifies `onPositionsChange` only when positions reach a committed state —
 * i.e. when the store's `transientDepth` is 0. During force-simulation ticks
 * or an in-flight node drag the consumer is not notified; a single
 * notification fires when the transient phase ends.
 */
export function usePositionSync<T>({
  nodes,
  initialPositions,
  onPositionsChange,
}: UsePositionSyncProps<T>) {
  const positions = useGraphCanvasStore((s) => s.positions);
  const transientDepth = useGraphCanvasStore((s) => s.transientDepth);
  const store = useRawGraphCanvasStore();

  // Keep store state aligned with the live node list, then seed any newly-added
  // nodes that have external initial positions.
  useEffect(() => {
    const nodeIds = nodes.map((node) => node.id);
    store.getState().pruneToNodes(nodeIds);

    const currentPositions = store.getState().positions;
    const updates = nodes.flatMap((node) => {
      if (currentPositions[node.id] || !initialPositions[node.id]) {
        return [];
      }
      const seededPosition = initialPositions[node.id];
      if (!Number.isFinite(seededPosition.x) || !Number.isFinite(seededPosition.y)) {
        return [];
      }
      return [{ id: node.id, x: seededPosition.x, y: seededPosition.y }];
    });

    if (updates.length > 0) {
      store.getState().setNodePositions(updates);
    }
  }, [initialPositions, nodes, store]);

  // Notify positions listener — only when we're at a committed state.
  const previousPositionsRef = useRef<Record<string, NodePosition> | null>(null);
  const pendingNotifyRef = useRef(false);
  useEffect(() => {
    const currentState = store.getState();
    const currentPositions = currentState.positions;
    const currentTransientDepth = currentState.transientDepth;

    if (havePositionsChanged(previousPositionsRef.current, currentPositions)) {
      pendingNotifyRef.current = true;
      previousPositionsRef.current = currentPositions;
    }
    if (pendingNotifyRef.current && currentTransientDepth === 0) {
      pendingNotifyRef.current = false;
      // Publish a detached snapshot. A consumer may retain or mutate its
      // callback argument; exposing the store's live object would let that
      // mutation bypass every finite-coordinate write guard.
      const snapshot = Object.create(null) as Record<string, NodePosition>;
      for (const [id, position] of Object.entries(currentPositions)) {
        snapshot[id] = { x: position.x, y: position.y };
      }
      onPositionsChange?.(snapshot);
    }
  }, [positions, transientDepth, onPositionsChange, store]);
}
