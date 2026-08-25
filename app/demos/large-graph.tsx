"use client";

import { useState, useEffect, useRef } from "react";
import { GraphCanvas, type GraphCanvasRef } from "@/graph-canvas";
import { GraphStage } from "./_shared/ui";
import { CIRCLE_RADIUS } from "./_shared/data";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";
import type { GraphNode, GraphEdge, NodeRenderProps } from "@/graph-canvas";

const NODE_COUNT = 10000;

// ─── Custom node renderer with selection overlay ───────────────────────────

function LargeGraphNode({ node, isSelected }: NodeRenderProps<CircleNodeData>) {
  const diameter = CIRCLE_RADIUS * 2;
  return (
    <div style={{ position: "relative", width: diameter, height: diameter }}>
      {/* Selection overlay ring */}
      {isSelected && (
        <div
          style={{
            position: "absolute",
            inset: -10,
            borderRadius: "50%",
            border: "2px solid #60a5fa",
            boxShadow:
              "0 0 0 4px rgba(96, 165, 250, 0.18), 0 0 22px rgba(96, 165, 250, 0.45)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Node body */}
      <div
        style={{
          width: diameter,
          height: diameter,
          boxSizing: "border-box",
          display: "grid",
          placeItems: "center",
          gap: 6,
          padding: 14,
          borderRadius: "50%",
          background: "#1e293b",
          border: `3px solid ${isSelected ? "#3b82f6" : "#475569"}`,
          color: "#e2e8f0",
          fontSize: 22,
          fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
          fontWeight: 500,
          lineHeight: 1,
          textAlign: "center",
          userSelect: "none",
          boxShadow: "0 12px 28px rgba(15, 23, 42, 0.38)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          {node.data.role}
        </div>
        <div>{node.data.label}</div>
      </div>
    </div>
  );
}

function buildLargeGraph(): {
  nodes: GraphNode<CircleNodeData>[];
  edges: GraphEdge<DemoEdgeData>[];
} {
  const nodes: GraphNode<CircleNodeData>[] = [];
  const edges: GraphEdge<DemoEdgeData>[] = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      id: `lg-${i}`,
      data: { label: `${i}`, role: "Node" },
    });
  }

  // Spanning chain ensures full connectivity
  for (let i = 0; i < NODE_COUNT - 1; i++) {
    edges.push({
      id: `lge-${i}`,
      source: `lg-${i}`,
      target: `lg-${i + 1}`,
      data: { label: "" },
    });
  }

  // Cross-links every 3rd node to node+8 for visual density
  let extra = NODE_COUNT - 1;
  for (let i = 0; i + 8 < NODE_COUNT; i += 3) {
    edges.push({
      id: `lge-${extra++}`,
      source: `lg-${i}`,
      target: `lg-${i + 8}`,
      data: { label: "" },
    });
  }

  return { nodes, edges };
}

const { nodes: largeNodes, edges: largeEdges } = buildLargeGraph();

const badgeStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 999,
  fontSize: 13,
};

export function LargeGraphDemo() {
  const graphRef = useRef<GraphCanvasRef>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.toLowerCase();
    // Find first node that matches the ID or label
    const match = largeNodes.find(
      (n) =>
        n.id.toLowerCase().includes(q) ||
        n.data.label?.toLowerCase().includes(q)
    );
    if (match) {
      if (!selectedIds.includes(match.id)) {
        setSelectedIds([match.id]);
      }
      graphRef.current?.panToNode(match.id, 1);
    }
  }, [searchQuery, selectedIds]);

  const selectionLabel =
    selectedIds.length === 0
      ? "Click a node to select. Shift+click to multi-select."
      : selectedIds.length === 1
        ? `Selected: ${selectedIds[0]}`
        : `${selectedIds.length} nodes selected: ${selectedIds.slice(0, 6).join(", ")}${selectedIds.length > 6 ? ` … +${selectedIds.length - 6} more` : ""}`;

  return (
    <div>
      <div
        style={{
          marginBottom: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span
          style={{
            ...badgeStyle,
            background: "rgba(14, 116, 144, 0.28)",
            border: "1px solid rgba(125, 211, 252, 0.3)",
            color: "#7dd3fc",
          }}
        >
          {largeNodes.length} nodes
        </span>
        <span
          style={{
            ...badgeStyle,
            background: "rgba(14, 116, 144, 0.28)",
            border: "1px solid rgba(125, 211, 252, 0.3)",
            color: "#7dd3fc",
          }}
        >
          {largeEdges.length} edges
        </span>
        <span
          style={{
            ...badgeStyle,
            background: "rgba(30, 41, 59, 0.72)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            color: "#94a3b8",
          }}
        >
          Canvas renderer active (threshold: 300)
        </span>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            style={{
              ...badgeStyle,
              background: "rgba(30, 41, 59, 0.72)",
              border: "1px solid rgba(148, 163, 184, 0.18)",
              color: "#f87171",
              cursor: "pointer",
            }}
          >
            Clear selection
          </button>
        )}
        <input
          type="text"
          placeholder="Search node... (e.g. lg-5000)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            ...badgeStyle,
            background: "rgba(15, 23, 42, 0.8)",
            border: "1px solid rgba(148, 163, 184, 0.4)",
            color: "#e2e8f0",
            outline: "none",
            width: 160,
          }}
        />
      </div>

      <GraphStage>
        <GraphCanvas<CircleNodeData, DemoEdgeData>
          graphRef={graphRef}
          nodes={largeNodes}
          edges={largeEdges}
          getNodeRadius={() => CIRCLE_RADIUS}
          renderNode={LargeGraphNode}
          renderCanvasNode={renderCircleCanvasNode}
          layoutEnabled={true}
          layoutLinkDistance={100}
          layoutChargeStrength={-100}
          selectedNodeIds={selectedIds}
          onSelectionChange={setSelectedIds}
          marqueeSelect
        />
      </GraphStage>

      <div
        style={{
          marginTop: 14,
          padding: "12px 16px",
          borderRadius: 16,
          background: "rgba(15, 23, 42, 0.72)",
          border: "1px solid rgba(148, 163, 184, 0.14)",
          color: selectedIds.length > 0 ? "#e2e8f0" : "#64748b",
          fontSize: 13,
          fontFamily: "monospace",
          minHeight: 42,
          display: "flex",
          alignItems: "center",
        }}
      >
        {selectionLabel}
      </div>
    </div>
  );
}
