"use client";

import { useMemo, useState } from "react";
import { GraphCanvas, MAIN_PORT_TYPE, PORT_BAR_HEIGHT, PORT_BAR_WIDTH, PORT_SIZE, findPort, getPortGlyph } from "@/graph-canvas";
import type {
  Connection,
  ConnectionContext,
  EdgeStyle,
  GraphContextMenuProps,
  GraphEdge,
  GraphNode,
  NodePosition,
  NodeRenderProps,
  PortBehavior,
  PortDef,
  PortRenderProps,
} from "@/graph-canvas";

// ─── Connection types ──────────────────────────────────────────────────────────
// "main" is the primary flow (solid, left→right); every other type
// is a typed resource attachment (dashed, hangs off the bottom of the node).

const PORT_COLOR: Record<string, string> = {
  [MAIN_PORT_TYPE]: "#6b7280",
  model: "#7c3aed",
  memory: "#059669",
  tool: "#0284c7",
  "output-parser": "#d97706",
};

const isResourcePort = (type: string) => type !== MAIN_PORT_TYPE;

// ─── Node data ─────────────────────────────────────────────────────────────────

type NodeShape = "rectangle" | "circle";

interface WorkflowNodeData {
  label: string;
  shape: NodeShape;
  ports: PortDef[];
  icon: string;
  accentColor: string;
}

type WFNode = GraphNode<WorkflowNodeData>;
type WFEdge = GraphEdge<Record<string, never>>;

// ─── Dimensions ────────────────────────────────────────────────────────────────

const RECT_W = 200;
const RECT_H = 76;
const CIRCLE_D = 84;

// ─── Port builders ─────────────────────────────────────────────────────────────

const mainIn = (): PortDef => ({ id: "in", type: MAIN_PORT_TYPE, mode: "input" });
const mainOut = (): PortDef => ({ id: "out", type: MAIN_PORT_TYPE, mode: "output" });

/** Resource ports sit along the bottom edge by default (mode: "input").
 *
 *  `behavior` splits them in two: Chat Model is drag-only, while Memory, Tool
 *  and Output Parser also carry the "+" endpoint that opens a menu of concrete
 *  provider types. */
interface ResourcePortOptions {
  behavior: PortBehavior;
  required?: boolean;
  maxConnections?: number;
}

const resource = (
  type: string,
  label: string,
  { behavior, required = false, maxConnections }: ResourcePortOptions
): PortDef => ({
  id: type,
  type,
  mode: "input",
  label,
  required,
  behavior,
  ...(maxConnections === undefined ? {} : { maxConnections }),
});

export const AGENT_PORTS: PortDef[] = [
  mainIn(),
  mainOut(),
  resource("model", "Chat Model", { behavior: "drag", required: true, maxConnections: 1 }),
  resource("memory", "Memory", { behavior: "both", maxConnections: 1 }),
  // Agents may use several tools at once. Omitting maxConnections makes this
  // a fan-in endpoint while the singular resources above remain capped.
  resource("tool", "Tool", { behavior: "both" }),
];

export const EVAL_PORTS: PortDef[] = [
  ...AGENT_PORTS,
  resource("output-parser", "Output Parser", { behavior: "both", maxConnections: 1 }),
];

// ─── Provider catalogue (what the port menu offers) ────────────────────────────

interface ProviderChoice {
  label: string;
  icon: string;
  accentColor: string;
}

/** Concrete node types that can satisfy each resource port type. */
const PROVIDER_CATALOGUE: Record<string, ProviderChoice[]> = {
  model: [
    { label: "OpenAI Chat Model", icon: "⚡", accentColor: "#065f46" },
    { label: "Anthropic Chat Model", icon: "🅰", accentColor: "#7c2d12" },
    { label: "Ollama Chat Model", icon: "🦙", accentColor: "#1e3a5f" },
  ],
  memory: [
    { label: "Window Buffer Memory", icon: "🗄️", accentColor: "#065f46" },
    { label: "Redis Chat Memory", icon: "📕", accentColor: "#7f1d1d" },
    { label: "Postgres Chat Memory", icon: "🐘", accentColor: "#1e3a5f" },
  ],
  tool: [
    { label: "SerpAPI", icon: "🔎", accentColor: "#1e3a5f" },
    { label: "Calculator", icon: "🧮", accentColor: "#4c1d95" },
    { label: "Code Tool", icon: "⌨️", accentColor: "#0e4f63" },
  ],
  "output-parser": [
    { label: "Structured Output Parser", icon: "{}", accentColor: "#7c2d12" },
    { label: "Item List Parser", icon: "≡", accentColor: "#1e3a5f" },
  ],
};

/** A resource provider exposes one outgoing port of its own type, on top. */
const providerPorts = (type: string): PortDef[] => [
  { id: "provides", type, mode: "output" },
];

// ─── Graph ─────────────────────────────────────────────────────────────────────

const INITIAL_NODES: WFNode[] = [
  { id: "trigger", data: { label: "Execute Workflow", shape: "rectangle", ports: [mainOut()], icon: "▶", accentColor: "#475569" } },
  { id: "ai-agent", data: { label: "AI Agent", shape: "rectangle", ports: AGENT_PORTS, icon: "🤖", accentColor: "#1e3a5f" } },
  { id: "loop", data: { label: "Loop Over Items", shape: "rectangle", ports: [mainIn(), mainOut()], icon: "🔄", accentColor: "#0e4f63" } },
  { id: "critic-agent", data: { label: "Critic Agent", shape: "rectangle", ports: AGENT_PORTS, icon: "🔍", accentColor: "#312e81" } },
  { id: "refiner-agent", data: { label: "Refiner Agent", shape: "rectangle", ports: AGENT_PORTS, icon: "✏️", accentColor: "#0e4f63" } },
  { id: "eval-agent", data: { label: "Evaluation Agent", shape: "rectangle", ports: EVAL_PORTS, icon: "📊", accentColor: "#1e3a5f" } },
  { id: "openai-model", data: { label: "OpenAI Chat Model", shape: "circle", ports: providerPorts("model"), icon: "⚡", accentColor: "#065f46" } },
  { id: "buffer-memory", data: { label: "Window Buffer Memory", shape: "circle", ports: providerPorts("memory"), icon: "🗄️", accentColor: "#065f46" } },
  { id: "serp-tool", data: { label: "SerpAPI", shape: "circle", ports: providerPorts("tool"), icon: "🔎", accentColor: "#1e3a5f" } },
];

const INITIAL_POSITIONS: Record<string, NodePosition> = {
  trigger: { x: -560, y: 0 },
  "ai-agent": { x: -300, y: 0 },
  loop: { x: -40, y: 0 },
  "critic-agent": { x: 220, y: 0 },
  "refiner-agent": { x: 480, y: 0 },
  "eval-agent": { x: 740, y: 0 },
  "openai-model": { x: 180, y: 280 },
  "buffer-memory": { x: 400, y: 280 },
  "serp-tool": { x: 600, y: 280 },
};

const INITIAL_EDGES: WFEdge[] = [
  { id: "e1", source: "trigger", target: "ai-agent", data: {}, sourcePort: "out", targetPort: "in" },
  { id: "e2", source: "ai-agent", target: "loop", data: {}, sourcePort: "out", targetPort: "in" },
  { id: "e3", source: "loop", target: "critic-agent", data: {}, sourcePort: "out", targetPort: "in" },
  { id: "e4", source: "critic-agent", target: "refiner-agent", data: {}, sourcePort: "out", targetPort: "in" },
  { id: "e5", source: "refiner-agent", target: "eval-agent", data: {}, sourcePort: "out", targetPort: "in" },
  // Resource attachments — dashed, no arrowhead, and anchored port-to-port.
  { id: "e6", source: "openai-model", target: "critic-agent", data: {}, sourcePort: "provides", targetPort: "model" },
  { id: "e7", source: "openai-model", target: "eval-agent", data: {}, sourcePort: "provides", targetPort: "model" },
  { id: "e8", source: "buffer-memory", target: "critic-agent", data: {}, sourcePort: "provides", targetPort: "memory" },
  { id: "e9", source: "serp-tool", target: "refiner-agent", data: {}, sourcePort: "provides", targetPort: "tool" },
];

// ─── Library configuration ─────────────────────────────────────────────────────
// Everything below is data the library consumes; no anchor math, no hand-placed
// port markup, no manual hit-testing.

const getNodePorts = (node: WFNode) => node.data.ports;

const getNodeSize = (node: WFNode) =>
  node.data.shape === "circle"
    ? { width: CIRCLE_D, height: CIRCLE_D }
    : { width: RECT_W, height: RECT_H };

const getNodeRadius = (node: WFNode) => (node.data.shape === "circle" ? CIRCLE_D / 2 : 90);

/** Output to input, and the port types must match. */
function isValidConnection({ sourcePortDef, targetPortDef }: ConnectionContext<WorkflowNodeData>) {
  if (!sourcePortDef || !targetPortDef) return false;
  if (sourcePortDef.mode === targetPortDef.mode) return false;
  return sourcePortDef.type === targetPortDef.type;
}

const MAIN_EDGE_STYLE: EdgeStyle = { stroke: "#64748b", strokeWidth: 2, markerEnd: true };
const RESOURCE_EDGE_STYLE: EdgeStyle = {
  stroke: "#94a3b8",
  strokeWidth: 1.5,
  strokeDasharray: "5,6",
  markerEnd: false,
};

/**
 * Main flow (in → out) is solid with an arrowhead; every typed resource
 * attachment is dashed without one.
 *
 * The decision has to be made on the port's *type*, resolved from the node —
 * `edge.targetPort` is an id, and the main ports are `in`/`out` while their
 * type is `main`, so comparing the id against the type marks everything as a
 * resource link and dashes the whole graph.
 */
function isResourceEdge(nodeById: Map<string, WFNode>, edge: WFEdge): boolean {
  const target = nodeById.get(edge.target);
  const portType = findPort(target?.data.ports ?? [], edge.targetPort)?.type;
  return isResourcePort(portType ?? MAIN_PORT_TYPE);
}

function makeGetEdgeStyle(nodeById: Map<string, WFNode>) {
  return (edge: WFEdge): EdgeStyle =>
    isResourceEdge(nodeById, edge) ? RESOURCE_EDGE_STYLE : MAIN_EDGE_STYLE;
}

// ─── Port visual ───────────────────────────────────────────────────────────────

function WorkflowPort({ port, isSnapTarget, isConnected }: PortRenderProps<WorkflowNodeData>) {
  const color = PORT_COLOR[port.type] ?? PORT_COLOR[MAIN_PORT_TYPE];
  const accent = isSnapTarget ? "#22c55e" : color;
  const glyph = getPortGlyph(port);

  return (
    <div
      style={{
        // Sizes come from PORT_SIZE/PORT_BAR_*: the anchor maths derives the
        // edge attachment point from the same constants, so the drawn glyph and
        // the edge endpoint stay in sync at every zoom level.
        width: glyph === "bar" ? PORT_BAR_WIDTH : PORT_SIZE,
        height: glyph === "bar" ? PORT_BAR_HEIGHT : PORT_SIZE,
        boxSizing: "border-box",
        transform: glyph === "diamond" ? "rotate(45deg)" : undefined,
        borderRadius: glyph === "circle" ? "50%" : 2,
        background: isConnected || isSnapTarget ? accent : "#fff",
        border: `1.5px solid ${accent}`,
        boxShadow: isSnapTarget ? `0 0 0 4px ${accent}44` : undefined,
        transition: "background 0.12s, border-color 0.12s, box-shadow 0.12s",
      }}
    />
  );
}

// ─── Node visuals ──────────────────────────────────────────────────────────────

function WorkflowNode({ node, isSelected, isDragging }: NodeRenderProps<WorkflowNodeData>) {
  const { label, shape, icon, accentColor } = node.data;
  const border = isSelected ? "#6366f1" : isDragging ? "#a5b4fc" : "rgba(0,0,0,0.1)";
  const shadow = isSelected
    ? "0 0 0 3px rgba(99,102,241,0.18), 0 4px 16px rgba(0,0,0,0.1)"
    : "0 2px 8px rgba(0,0,0,0.08)";

  if (shape === "circle") {
    return (
      <div
        style={{
          width: CIRCLE_D,
          height: CIRCLE_D,
          // Must match getNodeSize exactly, so the border counts *inside* the
          // box — otherwise ports sit inset by the border width.
          boxSizing: "border-box",
          borderRadius: "50%",
          background: "#fff",
          border: `1.5px solid ${border}`,
          boxShadow: shadow,
          display: "grid",
          placeItems: "center",
          position: "relative",
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: accentColor,
            display: "grid",
            placeItems: "center",
            fontSize: 16,
          }}
        >
          {icon}
        </div>
        <div
          style={{
            position: "absolute",
            top: "100%",
            marginTop: 8,
            fontSize: 11,
            fontWeight: 500,
            color: "#475569",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: RECT_W,
        height: RECT_H,
        // See the circle branch: the rendered border-box has to equal the size
        // reported by getNodeSize or every port is off by the border width.
        boxSizing: "border-box",
        borderRadius: 12,
        background: "#fff",
        border: `1px solid ${border}`,
        boxShadow: shadow,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 10,
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 9,
          background: accentColor,
          display: "grid",
          placeItems: "center",
          fontSize: 17,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#1e293b",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Demo ──────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  text: string;
}

/** Vertical gap between a port and a node the menu creates below it. */
const CREATED_NODE_DROP = 150;

export function WorkflowNodesDemo() {
  const [nodes, setNodes] = useState<WFNode[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<WFEdge[]>(INITIAL_EDGES);
  const [positions, setPositions] = useState<Record<string, NodePosition>>(INITIAL_POSITIONS);
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = (text: string) =>
    setLog((p) => [{ id: Date.now() + Math.random(), text }, ...p.slice(0, 5)]);

  // Edge styling needs to resolve a port id to its type, so it depends on the
  // (now mutable) node list rather than being a module-level function.
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const getEdgeStyle = useMemo(() => makeGetEdgeStyle(nodeById), [nodeById]);

  /**
   * Create a provider node for a port and wire it up in one step.
   *
   * The node is placed under the *port* (from `target.portPosition`) rather
   * than the node centre, so a node created from the Tool slot doesn't land on
   * top of one created from Memory.
   */
  const addProviderForPort = (
    ownerId: string,
    port: PortDef,
    choice: ProviderChoice,
    portPosition: NodePosition | undefined
  ) => {
    const used = edges.filter(
      (edge) => edge.target === ownerId && edge.targetPort === port.id
    ).length;
    if (port.maxConnections !== undefined && used >= port.maxConnections) {
      pushLog(`⚠ ${ownerId}:${port.id} is already at capacity`);
      return;
    }

    const id = `${port.type}-${Date.now()}`;
    const origin = portPosition ?? positions[ownerId] ?? { x: 0, y: 0 };

    setNodes((p) => [
      ...p,
      {
        id,
        data: {
          label: choice.label,
          shape: "circle",
          ports: providerPorts(port.type),
          icon: choice.icon,
          accentColor: choice.accentColor,
        },
      },
    ]);
    setPositions((p) => ({
      ...p,
      [id]: { x: origin.x, y: origin.y + CREATED_NODE_DROP },
    }));
    setEdges((p) => [
      ...p,
      {
        id: `e-${id}`,
        source: id,
        target: ownerId,
        data: {},
        sourcePort: "provides",
        targetPort: port.id,
      },
    ]);
    pushLog(`+ ${choice.label} → ${ownerId}:${port.id}`);
  };

  const handleConnect = (c: Connection) => {
    const duplicate = edges.some(
      (e) =>
        e.source === c.source &&
        e.target === c.target &&
        e.sourcePort === c.sourcePort &&
        e.targetPort === c.targetPort
    );
    if (duplicate) {
      pushLog(`⚠ ${c.source}:${c.sourcePort} → ${c.target}:${c.targetPort} already wired`);
      return;
    }
    setEdges((p) => [...p, { id: `e${Date.now()}`, data: {}, ...c }]);
    pushLog(`✓ ${c.source}:${c.sourcePort} → ${c.target}:${c.targetPort}`);
  };

  /** The port menu: offer every provider type that satisfies this port. */
  const renderContextMenu = ({
    target,
    closeMenu,
  }: GraphContextMenuProps<WorkflowNodeData, Record<string, never>>) => {
    if (target.kind !== "port" || !target.port) return null;
    const choices = PROVIDER_CATALOGUE[target.port.type];
    if (!choices) return null;
    const used = edges.filter(
      (edge) => edge.target === target.node.id && edge.targetPort === target.port!.id
    ).length;
    const atCapacity =
      target.port.maxConnections !== undefined && used >= target.port.maxConnections;

    return (
      <div
        style={{
          minWidth: 210,
          padding: 6,
          borderRadius: 12,
          background: "#fff",
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            padding: "6px 10px 8px",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#94a3b8",
          }}
        >
          Add {target.port.label ?? target.port.type}
        </div>
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            disabled={atCapacity}
            onClick={() => {
              addProviderForPort(target.node.id, target.port!, choice, target.portPosition);
              closeMenu();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              padding: "7px 10px",
              border: "none",
              borderRadius: 8,
              background: "transparent",
              color: "#1e293b",
              fontSize: 13,
              textAlign: "left",
              cursor: atCapacity ? "not-allowed" : "pointer",
              opacity: atCapacity ? 0.45 : 1,
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: choice.accentColor,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {choice.icon}
            </span>
            {choice.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          width: "100%",
          height: "min(72vh, 680px)",
          minHeight: 460,
          borderRadius: 20,
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        }}
      >
        <GraphCanvas<WorkflowNodeData, Record<string, never>>
          nodes={nodes}
          edges={edges}
          initialPositions={positions}
          layoutEnabled={false}
          renderAllNodes
          style={{ backgroundColor: "#eef2f8" }}
          showBackground="dots"
          showZoomControls
          snapToGrid={16}
          // ── Ports: one registry drives layout, rendering, anchoring and
          //    hit-testing. There is no anchor maths in this file.
          getNodePorts={getNodePorts}
          getNodeSize={getNodeSize}
          getNodeRadius={getNodeRadius}
          renderPort={WorkflowPort}
          isValidConnection={isValidConnection}
          onConnect={handleConnect}
          renderNode={WorkflowNode}
          renderContextMenu={renderContextMenu}
          getEdgeStyle={getEdgeStyle}
          getEdgeRoute={() => "s-curved"}
          // Resource links run further and read better with a deeper bow than
          // the short main-flow hops between adjacent nodes.
          getEdgeCurveStrength={({ edge }) =>
            edge && isResourceEdge(nodeById, edge) ? 2.2 : 1
          }
        />
      </div>

      <div
        style={{
          background: "rgba(15,23,42,0.7)",
          borderRadius: 14,
          border: "1px solid rgba(148,163,184,0.12)",
          padding: "14px 18px",
          fontFamily: "monospace",
          fontSize: 13,
          color: "#94a3b8",
          minHeight: 72,
        }}
      >
        <div
          style={{
            color: "#60a5fa",
            marginBottom: 8,
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Connection log
        </div>
        {log.length === 0 ? (
          <span style={{ color: "#475569" }}>
            Drag ● out → ● in to wire the flow, or ◆ from a provider up to a matching
            ◆ slot. Mismatched types turn the preview line red and refuse to connect.
          </span>
        ) : (
          log.map((entry, i) => (
            <div key={entry.id} style={{ opacity: 1 - i * 0.15, marginBottom: 2 }}>
              {entry.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
