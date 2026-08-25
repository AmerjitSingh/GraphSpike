"use client";

import { memo, useEffect, useRef } from "react";
import type { GraphEdge, GraphNode, NodePosition } from "../types.js";

interface AccessibilityLayerProps<T, E = unknown> {
  nodes: GraphNode<T>[];
  positions: Record<string, NodePosition>;
  selectedNodeIds: string[];
  focusedId: string | null;
  connectFromId: string | null;
  onFocusNode: (id: string) => void;
  /** Semantic button activation (AT, voice control, programmatic click). */
  onNodeActivate?: (id: string, event: React.MouseEvent) => void;
  /** Opens the managed menu for this semantic node. The visual anchor is
   *  resolved by GraphCanvas rather than from keyboard event coordinates. */
  onNodeContextMenu?: (id: string, event: React.MouseEvent) => void;
  /** Accessible name for each node; defaults to its label or id. */
  getNodeLabel?: (node: GraphNode<T>) => string;
  /** Node count is announced here so SR users get orientation on entry. */
  describedById: string;
  // ── Edges. Without these the edge canvas is aria-hidden raster and edges
  // are unreachable by keyboard entirely.
  edges?: GraphEdge<E>[];
  selectedEdgeIds?: string[];
  focusedEdgeId?: string | null;
  onFocusEdge?: (id: string) => void;
  onBlurEdge?: (id: string, event: React.FocusEvent) => void;
  onEdgeActivate?: (id: string, event: React.MouseEvent) => void;
  onEdgeContextMenu?: (id: string, event: React.MouseEvent) => void;
  getEdgeLabel?: (edge: GraphEdge<E>) => string | null | undefined;
  /** Announced on the focused node while a connect is armed, e.g.
   *  "connecting to Agent via Chat Model, 2 of 3". */
  connectHint?: string;
}

/** Nodes rendered either side of the focused one. A listbox with one button
 *  per node is unusable past a few hundred (and costs a DOM node each) — but
 *  the roving focus only ever moves one step at a time, so a window around it
 *  is always enough. `aria-setsize`/`aria-posinset` keep the announced count
 *  and position true to the whole graph. */
const A11Y_WINDOW = 50;

/** Visually hidden, but still focusable and in the accessibility tree —
 *  `display:none`/`visibility:hidden` would remove it from both. */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

function defaultLabel<T>(node: GraphNode<T>): string {
  const data = node.data as Record<string, unknown> | null;
  const label = data && typeof data === "object" ? data.label : undefined;
  return typeof label === "string" && label ? label : node.id;
}

/**
 * A real DOM element per node, positioned off-screen but focusable, so the
 * graph is reachable by keyboard and legible to screen readers. The visual
 * layers stay `aria-hidden` raster; this is the semantic mirror of them.
 *
 * Elements are visually hidden rather than `display:none`/`visibility:hidden`
 * (which would remove them from the a11y tree and make them unfocusable).
 */
function AccessibilityLayerInner<T, E>({
  nodes,
  positions,
  selectedNodeIds,
  focusedId,
  connectFromId,
  onFocusNode,
  onNodeActivate,
  onNodeContextMenu,
  getNodeLabel,
  describedById,
  edges,
  selectedEdgeIds,
  focusedEdgeId,
  onFocusEdge,
  onBlurEdge,
  onEdgeActivate,
  onEdgeContextMenu,
  getEdgeLabel,
  connectHint,
}: AccessibilityLayerProps<T, E>) {
  const selected = new Set(selectedNodeIds);
  const itemsRef = useRef(new Map<string, HTMLButtonElement>());

  const total = nodes.length;
  const focusIndex = focusedId ? nodes.findIndex((n) => n.id === focusedId) : 0;
  const anchor = focusIndex >= 0 ? focusIndex : 0;
  const windowStart = Math.max(0, anchor - A11Y_WINDOW);
  const windowed = nodes.slice(windowStart, Math.min(total, anchor + A11Y_WINDOW + 1));

  // Move real DOM focus to follow the roving focus, so screen readers announce
  // the node the keyboard handler considers current.
  useEffect(() => {
    if (!focusedId) return;
    const el = itemsRef.current.get(focusedId);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [focusedId]);

  const edgeItemsRef = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!focusedEdgeId) return;
    const el = edgeItemsRef.current.get(focusedEdgeId);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [focusedEdgeId]);

  // Windowed for the same reason nodes are: the 10k-node demo carries ~13,300
  // edges, and one hidden button each would put thousands of DOM elements back
  // into a graph whose whole point is that it doesn't have them. Roving focus
  // only moves one step at a time, so a window around it is always enough.
  const allEdges = edges ?? [];
  const edgeTotal = allEdges.length;
  const edgeIndex = focusedEdgeId ? allEdges.findIndex((e) => e.id === focusedEdgeId) : 0;
  const edgeAnchor = edgeIndex >= 0 ? edgeIndex : 0;
  const edgeStart = Math.max(0, edgeAnchor - A11Y_WINDOW);
  const edgeList = allEdges.slice(edgeStart, Math.min(edgeTotal, edgeAnchor + A11Y_WINDOW + 1));
  const selectedEdges = new Set(selectedEdgeIds ?? []);

  return (
    <>
      <div
      role="listbox"
      aria-label="Graph nodes"
      aria-multiselectable
      aria-describedby={describedById}
      style={SR_ONLY}
    >
      {windowed.map((node, index) => {
        const pos = positions[node.id];
        const name = (getNodeLabel ?? defaultLabel)(node);
        const isSelected = selected.has(node.id);
        return (
          <button
            key={node.id}
            type="button"
            ref={(el) => {
              if (el) itemsRef.current.set(node.id, el);
              else itemsRef.current.delete(node.id);
            }}
            role="option"
            aria-selected={isSelected}
            aria-setsize={total}
            aria-posinset={windowStart + index + 1}
            // Roving tabindex: one stop for the whole graph, then arrow keys.
            tabIndex={focusedId === node.id || (!focusedId && nodes[0]?.id === node.id) ? 0 : -1}
            onFocus={() => onFocusNode(node.id)}
            onClick={
              onNodeActivate ? (event) => onNodeActivate(node.id, event) : undefined
            }
            onContextMenu={
              onNodeContextMenu ? (event) => onNodeContextMenu(node.id, event) : undefined
            }
            data-gc-a11y-node={node.id}
          >
            {name}
            {pos ? `, at ${Math.round(pos.x)}, ${Math.round(pos.y)}` : ", position pending"}
            {isSelected ? ", selected" : ""}
            {connectFromId === node.id ? ", connecting from this node" : ""}
            {connectHint && focusedId === node.id ? `, ${connectHint}` : ""}
          </button>
        );
      })}
      </div>

      {edgeList.length > 0 && (
        <div role="listbox" aria-label="Graph edges" aria-multiselectable style={SR_ONLY}>
          {edgeList.map((edge, index) => {
            const isSelected = selectedEdges.has(edge.id);
            const custom = getEdgeLabel?.(edge);
            const name = custom || `${edge.source} to ${edge.target}`;
            return (
              <button
                key={edge.id}
                type="button"
                ref={(el) => {
                  if (el) edgeItemsRef.current.set(edge.id, el);
                  else edgeItemsRef.current.delete(edge.id);
                }}
                role="option"
                aria-selected={isSelected}
                aria-setsize={edgeTotal}
                aria-posinset={edgeStart + index + 1}
                // Roving tabindex, same as the node list: one tab stop for all
                // edges, then arrow keys within.
                tabIndex={
                  focusedEdgeId === edge.id || (!focusedEdgeId && edgeStart + index === 0) ? 0 : -1
                }
                onFocus={() => onFocusEdge?.(edge.id)}
                onBlur={(event) => onBlurEdge?.(edge.id, event)}
                onClick={
                  onEdgeActivate ? (event) => onEdgeActivate(edge.id, event) : undefined
                }
                onContextMenu={
                  onEdgeContextMenu ? (event) => onEdgeContextMenu(edge.id, event) : undefined
                }
                data-gc-a11y-edge={edge.id}
              >
                {`Edge, ${name}`}
                {isSelected ? ", selected" : ""}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export const AccessibilityLayer = memo(AccessibilityLayerInner) as <T, E>(
  props: AccessibilityLayerProps<T, E>
) => React.ReactElement | null;
