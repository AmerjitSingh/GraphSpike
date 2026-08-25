"use client";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { ExternalDropHandler, GraphLink } from "../link/GraphLink.js";
import type { GraphCanvasRef, GraphNode, Viewport } from "../types.js";

interface UseGraphLinkBridgeParams<T> {
  /** Resolved link — never null. When the graph isn't participating this is an
   *  inert fallback so the hook can subscribe unconditionally. */
  link: GraphLink;
  /** Whether this graph participates (has a linkId and a real link). */
  active: boolean;
  graphId: string | undefined;
  /** Map a local node id to its shared cross-graph key. */
  toKey: (id: string) => string | null;
  nodes: GraphNode<T>[];
  /** This graph's effective selection (controlled or internal). */
  selection: string[];
  /** This graph's currently-hovered node id, or null. */
  hoveredNodeId: string | null;
  /** Returns this graph's imperative handle for the registry. */
  getHandle: () => GraphCanvasRef | null;
  /** Returns this graph's container element (for coordinate mapping). */
  getContainer: () => HTMLElement | null;
  /** Returns this graph's current viewport. */
  getViewport: () => Viewport;
  /** Resolves this graph's current external-drop handler (read at drop time). */
  getOnExternalDrop: () => ExternalDropHandler | undefined;
}

/**
 * Bridges one <GraphCanvas>'s isolated store to a shared GraphLink:
 *  - registers the graph's imperative handle so peers can drive it,
 *  - publishes this graph's selection + hover as shared keys,
 *  - derives which local nodes to highlight from OTHER graphs' signals.
 *
 * Feedback-safe: a graph never reads its own published entry when deriving
 * highlights, and publishing depends only on selection/hover — never on the
 * derived highlight — so there is no publish→derive→publish loop.
 */
export function useGraphLinkBridge<T>({
  link,
  active,
  graphId,
  toKey,
  nodes,
  selection,
  hoveredNodeId,
  getHandle,
  getContainer,
  getViewport,
  getOnExternalDrop,
}: UseGraphLinkBridgeParams<T>): string[] {
  const sources = useStore(link.store, (s) => s.sources);

  // Register this graph. The getters read refs/store, so the registration
  // captured once here always resolves the latest handle/container/viewport.
  useEffect(() => {
    if (!active || !graphId) return;
    return link.register(graphId, { getHandle, getContainer, getViewport, getOnExternalDrop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, active, graphId]);

  // Publish selection + hover as shared keys whenever they change.
  useEffect(() => {
    if (!active || !graphId) return;
    const selectedKeys: string[] = [];
    for (const id of selection) {
      const k = toKey(id);
      if (k != null) selectedKeys.push(k);
    }
    const hoverKey = hoveredNodeId != null ? toKey(hoveredNodeId) : null;
    link.store.getState().publish(graphId, { selectedKeys, hoverKey });
  }, [link, active, graphId, selection, hoveredNodeId, toKey]);

  // Withdraw this graph's signals when it unmounts / stops participating.
  useEffect(() => {
    if (!active || !graphId) return;
    return () => link.store.getState().clear(graphId);
  }, [link, active, graphId]);

  // Derive highlighted local node ids from every OTHER graph's published keys.
  return useMemo(() => {
    if (!active) return [];
    const keys = new Set<string>();
    for (const [gid, pub] of Object.entries(sources)) {
      if (gid === graphId) continue; // never echo our own signals
      for (const k of pub.selectedKeys) keys.add(k);
      if (pub.hoverKey) keys.add(pub.hoverKey);
    }
    if (keys.size === 0) return [];
    const ids: string[] = [];
    for (const node of nodes) {
      const k = toKey(node.id);
      if (k != null && keys.has(k)) ids.push(node.id);
    }
    return ids;
  }, [active, sources, graphId, nodes, toKey]);
}
