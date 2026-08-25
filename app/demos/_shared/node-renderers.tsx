"use client";

import type { NodeRenderProps } from "@/graph-canvas";
import {
  CIRCLE_RADIUS,
  ROUNDED_RECT_WIDTH,
  ROUNDED_RECT_HEIGHT,
  ROUNDED_RECT_CORNER_RADIUS,
} from "./data";
import type {
  CircleNodeData,
  RoundedRectNodeData,
  MixedNodeData,
  EditorNodeData,
} from "./data";

export function CircleNode({
  node,
  isSelected,
  isHighlighted,
}: NodeRenderProps<CircleNodeData>) {
  const diameter = CIRCLE_RADIUS * 2;
  return (
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
        background: isSelected ? "#2563eb" : "#1e293b",
        border: `3px solid ${isHighlighted ? "#f59e0b" : isSelected ? "#bfdbfe" : "#475569"}`,
        outline: isHighlighted ? "3px solid #f59e0b" : undefined,
        outlineOffset: 3,
        color: "#e2e8f0",
        fontSize: 22,
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
        fontWeight: 500,
        lineHeight: 1,
        textAlign: "center",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.38)",
        userSelect: "none",
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
  );
}

export function RoundedRectangleNode({
  node,
  isSelected,
}: NodeRenderProps<RoundedRectNodeData>) {
  return (
    <div
      style={{
        width: ROUNDED_RECT_WIDTH,
        height: ROUNDED_RECT_HEIGHT,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        gap: 8,
        padding: 18,
        borderRadius: ROUNDED_RECT_CORNER_RADIUS,
        background: isSelected
          ? "linear-gradient(160deg, #0f766e, #0f172a)"
          : "linear-gradient(160deg, #164e63, #0f172a)",
        border: `3px solid ${isSelected ? "#99f6e4" : "#155e75"}`,
        color: "#ecfeff",
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
        textAlign: "center",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        boxShadow: "0 16px 30px rgba(8, 47, 73, 0.38)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          borderRadius: 999,
          background: "rgba(236, 254, 255, 0.14)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {node.data.status}
      </div>
      <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>
        {node.data.label}
      </div>
    </div>
  );
}

export function MixedShapeNode({ node, isSelected }: NodeRenderProps<MixedNodeData>) {
  if (node.data.shape === "circle") {
    const diameter = CIRCLE_RADIUS * 2;
    return (
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
          background: isSelected
            ? "linear-gradient(160deg, #1d4ed8, #0f172a)"
            : "linear-gradient(160deg, #1e3a8a, #0f172a)",
          border: `3px solid ${isSelected ? "#bfdbfe" : "#64748b"}`,
          color: "#e2e8f0",
          textAlign: "center",
          boxShadow: "0 16px 32px rgba(15, 23, 42, 0.35)",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.78,
          }}
        >
          {node.data.role}
        </div>
        <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>
          {node.data.label}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: ROUNDED_RECT_WIDTH,
        height: ROUNDED_RECT_HEIGHT,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        gap: 8,
        padding: 18,
        borderRadius: ROUNDED_RECT_CORNER_RADIUS,
        background: isSelected
          ? "linear-gradient(160deg, #0f766e, #0f172a)"
          : "linear-gradient(160deg, #164e63, #0f172a)",
        border: `3px solid ${isSelected ? "#99f6e4" : "#475569"}`,
        color: "#ecfeff",
        textAlign: "center",
        boxShadow: "0 16px 30px rgba(8, 47, 73, 0.32)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          borderRadius: 999,
          background: "rgba(236, 254, 255, 0.14)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {node.data.status}
      </div>
      <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>
        {node.data.label}
      </div>
    </div>
  );
}

export function EditorNode({ node, isSelected }: NodeRenderProps<EditorNodeData>) {
  if (node.data.shape === "circle") {
    const diameter = CIRCLE_RADIUS * 2;
    return (
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
          background: isSelected
            ? "linear-gradient(160deg, #1d4ed8, #0f172a)"
            : "linear-gradient(160deg, #1e3a8a, #0f172a)",
          border: `3px solid ${isSelected ? "#bfdbfe" : "#64748b"}`,
          color: "#e2e8f0",
          textAlign: "center",
          boxShadow: "0 16px 32px rgba(15, 23, 42, 0.35)",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.78,
          }}
        >
          {node.data.caption}
        </div>
        <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>
          {node.data.label}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: ROUNDED_RECT_WIDTH,
        height: ROUNDED_RECT_HEIGHT,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        gap: 8,
        padding: 18,
        borderRadius: ROUNDED_RECT_CORNER_RADIUS,
        background: isSelected
          ? "linear-gradient(160deg, #0f766e, #0f172a)"
          : "linear-gradient(160deg, #164e63, #0f172a)",
        border: `3px solid ${isSelected ? "#99f6e4" : "#475569"}`,
        color: "#ecfeff",
        textAlign: "center",
        boxShadow: "0 16px 30px rgba(8, 47, 73, 0.32)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          borderRadius: 999,
          background: "rgba(236, 254, 255, 0.14)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {node.data.caption}
      </div>
      <div style={{ fontSize: 24, fontWeight: 500, lineHeight: 1 }}>
        {node.data.label}
      </div>
    </div>
  );
}

/** Connector handle used in the graph editor. */
export function EditorConnectorHandle() {
  return (
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: "#67d7ff",
        border: "2px solid rgba(3, 37, 74, 0.92)",
        boxShadow: "0 0 0 3px rgba(3, 37, 74, 0.28)",
      }}
    />
  );
}
