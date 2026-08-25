"use client";

import type { ReactNode } from "react";
import type { GraphNode, PortDef } from "@/graph-canvas";
import { CONNECTOR_PORT_SIZE } from "./data";

export function GraphStage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "min(70vh, 640px)",
        minHeight: 420,
        borderRadius: 28,
        overflow: "hidden",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        boxShadow: "0 28px 56px rgba(2, 6, 23, 0.32)",
      }}
    >
      {children}
    </div>
  );
}

export function SourceConnectorHandle() {
  return (
    <div
      style={{
        width: CONNECTOR_PORT_SIZE,
        height: CONNECTOR_PORT_SIZE,
        borderRadius: "50%",
        background: "#67d7ff",
        border: "2px solid rgba(3, 37, 74, 0.92)",
        boxShadow: "0 0 0 4px rgba(3, 37, 74, 0.42)",
      }}
    />
  );
}

/** The single right-hand output port most demos use, expressed as a registry.
 *  Ports replaced `renderConnectorHandle`, so this is the equivalent one-liner. */
export const SINGLE_OUTPUT_PORT: PortDef[] = [
  { id: "out", type: "main", mode: "output" },
];

export const singleOutputPort = (): PortDef[] => SINGLE_OUTPUT_PORT;

/** Restrict the output port to specific node ids (others get no port at all). */
export function outputPortFor<T>(ids: string[]): (node: GraphNode<T>) => PortDef[] {
  const allowed = new Set(ids);
  return (node) => (allowed.has(node.id) ? SINGLE_OUTPUT_PORT : []);
}

export function DemoContextMenuFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minWidth: 220,
        display: "grid",
        gap: 10,
        padding: 14,
        borderRadius: 18,
        background: "rgba(15, 23, 42, 0.96)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        boxShadow: "0 18px 44px rgba(2, 6, 23, 0.52)",
        color: "#e2e8f0",
        backdropFilter: "blur(12px)",
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#7dd3fc",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
}

export function DemoContextMenuButton({
  label,
  onClick,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        border: "none",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 12,
        background:
          tone === "danger" ? "rgba(127, 29, 29, 0.32)" : "rgba(30, 41, 59, 0.92)",
        color: tone === "danger" ? "#fecaca" : "#e2e8f0",
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );
}

export function DemoTogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        border: active
          ? "1px solid rgba(125, 211, 252, 0.6)"
          : "1px solid rgba(148, 163, 184, 0.18)",
        borderRadius: 999,
        padding: "8px 12px",
        background: active ? "rgba(14, 116, 144, 0.34)" : "rgba(15, 23, 42, 0.72)",
        color: active ? "#e0f2fe" : "#cbd5e1",
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );
}

export function InfoPanel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 18,
        display: "grid",
        gap: 10,
        padding: 18,
        borderRadius: 22,
        background: "rgba(15, 23, 42, 0.72)",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        color: "#cbd5e1",
      }}
    >
      {children}
    </div>
  );
}
