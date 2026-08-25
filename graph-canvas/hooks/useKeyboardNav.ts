"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphCanvasStore } from "../store.js";
import type { Connection, GraphNode, NodePosition, PortDef } from "../types.js";
import { resolveNodePorts, snapValueToGrid } from "../ports.js";
import { isForeignKeyTarget } from "../interaction.js";

/** How far an arrow-key nudge moves a node, in graph units. */
const MOVE_STEP = 20;
const MOVE_STEP_LARGE = 100;

interface UseKeyboardNavParams<T> {
  nodes: GraphNode<T>[];
  positions: Record<string, NodePosition>;
  store: GraphCanvasStore;
  /** Bring a node into view (used when focus moves off screen). */
  panToNode: (id: string) => void;
  onNodeMove?: (id: string, x: number, y: number) => void;
  onConnect?: (connection: Connection) => void;
  /** Fires when activation selected a node (not when it completed a pending
   *  connect). Receives the triggering event — a KeyboardEvent for Enter/Space,
   *  a MouseEvent for an assistive-tech click — so both paths reach the same
   *  consumer callback. */
  onNodeActivate?: (id: string, event: React.SyntheticEvent) => void;
  enabled: boolean;
  /** Quantise nudged positions to this grid, matching pointer dragging. */
  snapToGrid?: number;
  /** Ports available on a node, so a keyboard connect can name one the same
   *  way a pointer drag does. */
  getNodePorts?: (node: GraphNode<T>) => PortDef[];
  /** The graph's shared connection validator (see `validation.ts`). Without it
   *  the keyboard path would create edges the pointer path forbids. */
  validateConnection?: (connection: Connection) => boolean;
  /** Edge ids in render order, so keyboard users can reach them at all. */
  edgeIds?: string[];
  /** Enter on a focused edge. Edge selection is consumer-controlled, so this
   *  is how a keyboard user acts on one. */
  onEdgeActivate?: (id: string) => void;
}

/**
 * Keyboard operation of the graph.
 *
 * The canvas layers are `aria-hidden` raster, so without this the graph is
 * pointer-only: keyboard and screen-reader users can't discover, select, move
 * or connect anything. This drives a roving-focus model over the node list,
 * which `GraphCanvas` mirrors into a real focusable DOM layer.
 *
 * Bindings (when the graph has focus):
 *   Tab / Shift+Tab   move focus between nodes (roving tabindex)
 *   Arrow keys        move focus to the nearest node in that direction
 *   Enter / Space     select the focused node (Shift to add to the selection)
 *   Alt + Arrows      nudge the selected node(s); hold Shift for a bigger step
 *   c then a node     connect: press `c` on a node, then Enter on another
 *   [ / ]             cycle which port pairing that connect would use
 *   Escape            clear the selection / cancel a pending connect
 *
 * Edges get their own listbox; arrows move between them and Enter activates.
 */
export function useKeyboardNav<T>({
  nodes,
  positions,
  store,
  panToNode,
  onNodeMove,
  onConnect,
  onNodeActivate,
  enabled,
  snapToGrid,
  getNodePorts,
  validateConnection,
  edgeIds,
  onEdgeActivate,
}: UseKeyboardNavParams<T>) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [focusedEdgeId, setFocusedEdgeId] = useState<string | null>(null);
  // Which of the valid port pairings the user has cycled to.
  const [candidateIndex, setCandidateIndex] = useState(0);

  // Keep the focused node valid as the graph changes.
  useEffect(() => {
    if (focusedId && !nodes.some((n) => n.id === focusedId)) setFocusedId(null);
    if (connectFromId && !nodes.some((n) => n.id === connectFromId)) setConnectFromId(null);
  }, [nodes, focusedId, connectFromId]);

  useEffect(() => {
    if (focusedEdgeId && !(edgeIds ?? []).includes(focusedEdgeId)) setFocusedEdgeId(null);
  }, [edgeIds, focusedEdgeId]);

  const orderedIds = useMemo(() => nodes.map((n) => n.id), [nodes]);

  const latest = useRef({ focusedId, connectFromId, positions, orderedIds });
  latest.current = { focusedId, connectFromId, positions, orderedIds };

  /** Nearest node in a compass direction, biased to keep travel predictable. */
  const findNeighbour = useCallback(
    (fromId: string, dx: number, dy: number): string | null => {
      const { positions: pos, orderedIds: ids } = latest.current;
      const from = pos[fromId];
      if (!from) return null;
      let best: string | null = null;
      let bestScore = Infinity;
      for (const id of ids) {
        if (id === fromId) continue;
        const p = pos[id];
        if (!p) continue;
        const vx = p.x - from.x;
        const vy = p.y - from.y;
        // Must lie in the requested half-plane.
        const along = vx * dx + vy * dy;
        if (along <= 0) continue;
        const across = Math.abs(vx * dy - vy * dx);
        // Prefer nodes close in the travel direction and near the axis.
        const score = along + across * 2;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      return best;
    },
    []
  );

  const focusNode = useCallback(
    (id: string | null, { reveal = true }: { reveal?: boolean } = {}) => {
      setFocusedId(id);
      if (id && reveal) panToNode(id);
    },
    [panToNode]
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /**
   * Every source/target port pairing the shared validator accepts.
   *
   * A pointer drag names its ports by aiming at them; the keyboard has no such
   * gesture, so it enumerates instead and lets the user cycle. Silently taking
   * the first pair would make a multi-port node unusable by keyboard: on an
   * agent with model/memory/tool inputs, "connect" would always mean whichever
   * port happened to be declared first.
   *
   * A node with no port for a direction contributes a single `undefined`
   * candidate — the perimeter connection the pointer path would make.
   */
  const connectionCandidates = useCallback(
    (sourceId: string, targetId: string): Connection[] => {
      const sourceNode = nodeById.get(sourceId);
      const targetNode = nodeById.get(targetId);
      if (!sourceNode || !targetNode) return [];

      // Mirror the validator: an end offers a port only if it has one *for
      // that direction*. Enumerating every port instead meant an output-only
      // node produced only illegal target candidates, so the keyboard refused
      // a connection the pointer path makes at the target's perimeter.
      const outputs = resolveNodePorts(sourceNode, getNodePorts).filter((p) => p.mode === "output");
      const inputs = resolveNodePorts(targetNode, getNodePorts).filter((p) => p.mode === "input");
      const sourceIds: (string | undefined)[] =
        outputs.length > 0 ? outputs.map((p) => p.id) : [undefined];
      const targetIds: (string | undefined)[] =
        inputs.length > 0 ? inputs.map((p) => p.id) : [undefined];

      const found: Connection[] = [];
      for (const sourcePort of sourceIds) {
        for (const targetPort of targetIds) {
          const connection: Connection = {
            source: sourceId, sourcePort, target: targetId, targetPort,
          };
          if (!validateConnection || validateConnection(connection)) found.push(connection);
        }
      }
      return found;
    },
    [nodeById, getNodePorts, validateConnection]
  );

  const candidates = useMemo(() => {
    if (!connectFromId || !focusedId || connectFromId === focusedId) return [];
    return connectionCandidates(connectFromId, focusedId);
  }, [connectFromId, focusedId, connectionCandidates]);

  // Start from the first pairing again whenever the pair of nodes changes.
  useEffect(() => { setCandidateIndex(0); }, [connectFromId, focusedId]);

  const connectCandidate = candidates.length > 0
    ? candidates[Math.min(candidateIndex, candidates.length - 1)]
    : null;

  const nudgeSelection = useCallback(
    (dx: number, dy: number, large: boolean) => {
      const state = store.getState();
      const ids = state.selectedNodeIds.length
        ? state.selectedNodeIds
        : latest.current.focusedId
          ? [latest.current.focusedId]
          : [];
      if (ids.length === 0) return;
      const step = large ? MOVE_STEP_LARGE : MOVE_STEP;
      const updates = ids.flatMap((id) => {
        const p = state.positions[id];
        if (!p) return [];
        return [{
          id,
          x: snapValueToGrid(p.x + dx * step, snapToGrid),
          y: snapValueToGrid(p.y + dy * step, snapToGrid),
        }];
      });
      if (updates.length === 0) return;
      // Wrap in a transient so onPositionsChange fires once for the nudge.
      state.beginTransient();
      state.setNodePositions(updates);
      state.endTransient();
      for (const u of updates) onNodeMove?.(u.id, u.x, u.y);
    },
    [store, onNodeMove, snapToGrid]
  );

  /** Shared semantic activation for keydown and assistive-tech `click`.
   * Returns true when activation selected the node, false when it completed a
   * pending connection instead. */
  const activateNode = useCallback(
    (id: string, shiftKey: boolean, event: React.SyntheticEvent): boolean => {
      const { focusedId: focused, connectFromId: connectFrom } = latest.current;
      if (connectFrom && connectFrom !== id) {
        const options = connectionCandidates(connectFrom, id);
        // A direct AT click can target an option before its focus event updates
        // React state. New targets start at the first valid port pairing; a
        // click on the already-focused target keeps the cycled choice.
        const index = focused === id ? Math.min(candidateIndex, options.length - 1) : 0;
        const candidate = options[index];
        if (candidate) onConnect?.(candidate);
        setConnectFromId(null);
        return false;
      }
      if (shiftKey) store.getState().toggleSelection(id);
      else store.getState().setSelection([id]);
      onNodeActivate?.(id, event);
      return true;
    },
    [candidateIndex, connectionCandidates, onConnect, onNodeActivate, store]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      // The container has no tabIndex, so every key event here bubbled up from
      // a descendant. Without this guard the graph's single-letter shortcuts
      // swallow typing in a consumer's `<input>`, and its arrows fight the
      // caret — the graph would be hijacking controls it doesn't own.
      if (isForeignKeyTarget(e)) return;
      // Every binding below is unmodified, or uses Alt/Shift. A key held with
      // Ctrl/Cmd belongs to the browser or the OS — without this, Cmd+C on a
      // focused node armed a connect *and* preventDefault'd the copy.
      if (e.ctrlKey || e.metaKey) return;

      // Edges have their own listbox in the accessibility layer, so a key that
      // arrived from one is an edge command, not a node command.
      const fromEdge = (e.target as HTMLElement | null)?.closest?.("[data-gc-a11y-edge]");
      if (fromEdge) {
        const list = edgeIds ?? [];
        if (list.length === 0) return;
        const at = focusedEdgeId ? list.indexOf(focusedEdgeId) : -1;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          setFocusedEdgeId(list[Math.min(at + 1, list.length - 1)] ?? list[0]);
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusedEdgeId(list[Math.max(at - 1, 0)] ?? list[0]);
          return;
        }
        if (e.key === "Home") { e.preventDefault(); setFocusedEdgeId(list[0]); return; }
        if (e.key === "End") { e.preventDefault(); setFocusedEdgeId(list[list.length - 1]); return; }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (focusedEdgeId) onEdgeActivate?.(focusedEdgeId);
          return;
        }
        return;
      }

      const { focusedId: focused, connectFromId: connectFrom, orderedIds: ids } = latest.current;

      // Cycle which port pairing a pending connect would use. Only meaningful
      // while armed with more than one option.
      if ((e.key === "[" || e.key === "]") && candidates.length > 1) {
        e.preventDefault();
        setCandidateIndex((i) => {
          const n = candidates.length;
          return (((e.key === "]" ? i + 1 : i - 1) % n) + n) % n;
        });
        return;
      }

      // Arrow keys: move a node with Alt, otherwise move focus.
      const arrow: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const dir = arrow[e.key];
      if (dir) {
        e.preventDefault();
        if (e.altKey) {
          nudgeSelection(dir[0], dir[1], e.shiftKey);
          return;
        }
        if (!focused) {
          focusNode(ids[0] ?? null);
          return;
        }
        const next = findNeighbour(focused, dir[0], dir[1]);
        if (next) focusNode(next);
        return;
      }

      switch (e.key) {
        case "Enter":
        case " ": {
          if (!focused) return;
          e.preventDefault();
          activateNode(focused, e.shiftKey, e);
          return;
        }
        case "c":
        case "C": {
          if (!focused || !onConnect) return;
          e.preventDefault();
          setConnectFromId(focused);
          return;
        }
        case "Escape": {
          e.preventDefault();
          if (connectFrom) setConnectFromId(null);
          else store.getState().clearSelection();
          return;
        }
        case "Home": {
          e.preventDefault();
          focusNode(ids[0] ?? null);
          return;
        }
        case "End": {
          e.preventDefault();
          focusNode(ids[ids.length - 1] ?? null);
          return;
        }
        default:
          return;
      }
    },
    [
      enabled, findNeighbour, focusNode, nudgeSelection, onConnect, store,
      activateNode, candidates.length, edgeIds, focusedEdgeId, onEdgeActivate,
    ]
  );

  const focusEdge = useCallback((id: string | null) => setFocusedEdgeId(id), []);

  return {
    focusedId,
    connectFromId,
    focusNode,
    activateNode,
    onKeyDown,
    focusedEdgeId,
    focusEdge,
    /** The port pairing Enter would commit, for announcement. */
    connectCandidate,
    connectCandidateIndex: candidates.length > 0 ? Math.min(candidateIndex, candidates.length - 1) : 0,
    connectCandidateCount: candidates.length,
  };
}
