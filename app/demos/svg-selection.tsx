"use client";

import { useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { GraphEdge, GraphNode, NodeRenderProps, RenderCanvasNodeProps } from "@/graph-canvas";
import { GraphStage, InfoPanel } from "./_shared/ui";

// ─── Data types ───────────────────────────────────────────────────────────────

type NodeGroup = "service" | "component" | "database" | "gateway";

interface SvgNodeData {
  label: string;
  group: NodeGroup;
}

type SvgEdgeData = Record<string, never>;

// ─── Group palette ────────────────────────────────────────────────────────────

const GROUP_PALETTE: Record<
  NodeGroup,
  { bg: string; border: string; selBg: string; selBorder: string; ring: string }
> = {
  service:   { bg: "#1e3a5f", border: "#3b82f6", selBg: "#1d4ed8", selBorder: "#93c5fd", ring: "#3b82f655" },
  component: { bg: "#2d1b69", border: "#7c3aed", selBg: "#5b21b6", selBorder: "#c4b5fd", ring: "#7c3aed55" },
  database:  { bg: "#064e3b", border: "#059669", selBg: "#047857", selBorder: "#6ee7b7", ring: "#05966955" },
  gateway:   { bg: "#7c2d12", border: "#ea580c", selBg: "#c2410c", selBorder: "#fdba74", ring: "#ea580c55" },
};

const GROUPS: NodeGroup[] = ["service", "component", "database", "gateway"];

const GROUP_LABELS: Record<NodeGroup, string> = {
  service: "Service",
  component: "Component",
  database: "Database",
  gateway: "Gateway",
};

// ─── Node dimensions ──────────────────────────────────────────────────────────

const NODE_W = 92;
const NODE_H = 38;
// Radius used for edge anchoring — approximates the bounding circle.
const NODE_RADIUS = 22;

// ─── Graph data ───────────────────────────────────────────────────────────────

const svgNodes: GraphNode<SvgNodeData>[] = Array.from({ length: 100 }, (_, i) => ({
  id: `n${String(i + 1).padStart(3, "0")}`,
  data: {
    label: `N-${String(i + 1).padStart(3, "0")}`,
    group: GROUPS[i % 4],
  },
}));

function buildEdges(): GraphEdge<SvgEdgeData>[] {
  const edges: GraphEdge<SvgEdgeData>[] = [];
  // Sequential chain: 99 edges.
  for (let i = 0; i < 99; i++) {
    edges.push({ id: `ec${i}`, source: svgNodes[i].id, target: svgNodes[i + 1].id, data: {} });
  }
  // Skip-3 cross-links: 33 edges (total = 132, well below the 280 SVG threshold).
  for (let i = 0; i + 3 < 100; i += 3) {
    edges.push({ id: `es${i}`, source: svgNodes[i].id, target: svgNodes[i + 3].id, data: {} });
  }
  return edges;
}

const svgEdges = buildEdges();

// ─── Node renderer ────────────────────────────────────────────────────────────

function SvgSelectionNode({ node, isSelected }: NodeRenderProps<SvgNodeData>) {
  const palette = GROUP_PALETTE[node.data.group];
  return (
    <div style={{ position: "relative", width: NODE_W, height: NODE_H }}>
      {isSelected && (
        <div
          style={{
            position: "absolute",
            inset: -7,
            borderRadius: 12,
            border: `2px solid ${palette.selBorder}`,
            boxShadow: `0 0 0 4px ${palette.ring}, 0 0 20px ${palette.ring}`,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          width: NODE_W,
          height: NODE_H,
          boxSizing: "border-box",
          display: "grid",
          placeItems: "center",
          borderRadius: 8,
          background: isSelected ? palette.selBg : palette.bg,
          border: `2px solid ${isSelected ? palette.selBorder : palette.border}`,
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: '"SF Mono", "Fira Code", monospace',
          fontWeight: 600,
          letterSpacing: "0.06em",
          userSelect: "none",
          transition: "background 0.1s, border-color 0.1s",
        }}
      >
        {node.data.label}
      </div>
    </div>
  );
}

function renderSvgCanvasNode({ ctx, node, x, y, zoom }: RenderCanvasNodeProps<SvgNodeData>): boolean {
  const palette = GROUP_PALETTE[node.data.group];
  const w = NODE_W * zoom;
  const h = NODE_H * zoom;
  const r = 8 * zoom;

  const left = x - w / 2;
  const top = y - h / 2;

  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(left, top, w, h, r);
  } else {
    const cr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(left + cr, top);
    ctx.arcTo(left + w, top, left + w, top + h, cr);
    ctx.arcTo(left + w, top + h, left, top + h, cr);
    ctx.arcTo(left, top + h, left, top, cr);
    ctx.arcTo(left, top, left + w, top, cr);
    ctx.closePath();
  }

  ctx.fillStyle = palette.bg;
  ctx.fill();

  ctx.lineWidth = 2 * zoom;
  ctx.strokeStyle = palette.border;
  ctx.stroke();

  const fontSize = 11 * zoom;
  ctx.font = `600 ${fontSize}px "SF Mono", "Fira Code", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e2e8f0";
  if ('letterSpacing' in ctx) {
    (ctx as any).letterSpacing = "0.06em";
  }
  ctx.fillText(node.data.label, x, y);
  if ('letterSpacing' in ctx) {
    (ctx as any).letterSpacing = "0px";
  }

  return true;
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

export function SvgSelectionDemo() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Per-group selection counts for the info panel.
  const selectedSet = new Set(selectedIds);
  const groupCounts = Object.fromEntries(
    GROUPS.map((g) => [
      g,
      svgNodes.filter((n) => selectedSet.has(n.id) && n.data.group === g).length,
    ])
  ) as Record<NodeGroup, number>;

  return (
    <div>
      <GraphStage>
        <GraphCanvas<SvgNodeData, SvgEdgeData>
          nodes={svgNodes}
          edges={svgEdges}
          getNodeRadius={() => NODE_RADIUS}
          getNodeShape={() => "rectangle"}
          renderNode={SvgSelectionNode}
          renderCanvasNode={renderSvgCanvasNode}
          selectedNodeIds={selectedIds}
          onSelectionChange={setSelectedIds}
          marqueeSelect
          layoutLinkDistance={80}
          layoutChargeStrength={-220}
        />
      </GraphStage>

      <InfoPanel>
        {/* Row 1 — count + clear */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 14 }}>
            <span style={{ color: "#60a5fa", fontWeight: 700 }}>
              {selectedIds.length}
            </span>
            <span style={{ color: "#64748b" }}> / 100 nodes selected</span>
          </div>

          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              style={{
                appearance: "none",
                border: "1px solid rgba(148, 163, 184, 0.22)",
                borderRadius: 999,
                padding: "3px 12px",
                background: "rgba(30, 41, 59, 0.8)",
                color: "#94a3b8",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Row 2 — per-group badges */}
        {selectedIds.length > 0 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {GROUPS.map((group) => {
              const count = groupCounts[group];
              if (count === 0) return null;
              const palette = GROUP_PALETTE[group];
              return (
                <div
                  key={group}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: `${palette.selBg}44`,
                    border: `1px solid ${palette.border}88`,
                    fontSize: 12,
                    color: palette.selBorder,
                  }}
                >
                  <span>{GROUP_LABELS[group]}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: `${palette.selBg}99`,
                    }}
                  >
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Row 3 — hints */}
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
          Click to select one · Shift+click to add or remove ·
          Drag on blank canvas for marquee select ·
          Drag any selected node to move the whole group
        </div>
      </InfoPanel>
    </div>
  );
}
