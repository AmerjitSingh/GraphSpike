"use client";

import { useRef, useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { Connection, GraphContextMenuProps, NodePosition } from "@/graph-canvas";
import {
  GraphStage,
  InfoPanel,
  DemoContextMenuFrame,
  DemoContextMenuButton,
  DemoTogglePill,
} from "./_shared/ui";
import { EditorNode, EditorConnectorHandle } from "./_shared/node-renderers";
import { singleOutputPort } from "./_shared/ui";
import { renderEditorCanvasNode } from "./_shared/canvas-renderers";
import {
  editorInitialNodes,
  editorInitialEdges,
  editorInitialPositions,
  EDGE_ROUTE_OPTIONS,
} from "./_shared/data";
import type { EditorNodeData, EditorEdgeData, EditorNodeShape } from "./_shared/data";
import {
  getEditorNodeRadius,
  getEditorNodeSize,
  getEditorNodeAnchor,
  getEditorEdgeStyle,
  getRouteCurveStrength,
  getRouteLabel,
  createEditorNode,
  createEditorEdge,
} from "./_shared/utils";
import type { EdgeRouteType } from "@/graph-canvas";

export function GraphEditorDemo() {
  const [nodes, setNodes] = useState(editorInitialNodes);
  const [edges, setEdges] = useState(editorInitialEdges);
  const [positions, setPositions] = useState(editorInitialPositions);
  // `initialPositions` only seeds nodes that have no position yet, so changing
  // it cannot pull already-dragged nodes back. Bumping this key remounts the
  // canvas, which discards its per-instance store and reseeds from scratch.
  const [resetKey, setResetKey] = useState(0);
  const [nextNodeShape, setNextNodeShape] = useState<EditorNodeShape>("circle");
  const [nextEdgeRoute, setNextEdgeRoute] = useState<EdgeRouteType>("s-curved");
  const [nextEdgeDashed, setNextEdgeDashed] = useState(false);
  const [message, setMessage] = useState(
    "Double-click blank canvas to add the selected node shape. Drag a connector to create the selected edge route. Right-click nodes, connectors, edges, or canvas to edit."
  );
  const nextNodeId = useRef(editorInitialNodes.length + 1);
  const nextEdgeId = useRef(editorInitialEdges.length + 1);

  const addNodeAt = (shape: EditorNodeShape, position: NodePosition) => {
    const node = createEditorNode(nextNodeId.current++, shape);
    setNodes((prev) => [...prev, node]);
    setPositions((prev) => ({ ...prev, [node.id]: position }));
    setMessage(`Added ${shape} node ${node.data.label}.`);
  };

  const removeNodeById = (id: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== id));
    setEdges((prev) => prev.filter((edge) => edge.source !== id && edge.target !== id));
    setPositions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMessage(`Removed node ${id} and any connected edges.`);
  };

  const updateNodeShape = (id: string, shape: EditorNodeShape) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, shape, caption: shape === "circle" ? "Circle" : "Rectangle" },
            }
          : node
      )
    );
    setMessage(`Converted ${id} to ${shape}.`);
  };

  const handleConnect = ({ source: sourceId, target: targetId }: Connection) => {
    if (sourceId === targetId) {
      setMessage("Self-connections are ignored.");
      return;
    }

    const duplicate = edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId
    );

    if (duplicate) {
      setMessage(`Skipped duplicate edge: ${sourceId} -> ${targetId}`);
      return;
    }

    const edge = createEditorEdge(
      nextEdgeId.current++,
      sourceId,
      targetId,
      nextEdgeRoute,
      nextEdgeDashed
    );
    setEdges((prev) => [...prev, edge]);
    setMessage(
      `Created ${nextEdgeDashed ? "dashed" : "solid"} ${getRouteLabel(nextEdgeRoute)} edge ${sourceId} -> ${targetId}.`
    );
  };

  const removeEdgeById = (id: string) => {
    setEdges((prev) => prev.filter((edge) => edge.id !== id));
    setMessage(`Removed edge ${id}.`);
  };

  const updateEdgeRoute = (id: string, route: EdgeRouteType) => {
    setEdges((prev) =>
      prev.map((edge) =>
        edge.id === id
          ? { ...edge, data: { ...edge.data, route, label: getRouteLabel(route) } }
          : edge
      )
    );
    setMessage(`Changed ${id} to ${getRouteLabel(route)}.`);
  };

  const toggleEdgeDashed = (id: string) => {
    let nextDashed = false;
    setEdges((prev) =>
      prev.map((edge) => {
        if (edge.id !== id) return edge;
        nextDashed = !edge.data.dashed;
        return { ...edge, data: { ...edge.data, dashed: nextDashed } };
      })
    );
    setMessage(`${nextDashed ? "Dashed" : "Solid"} style applied to ${id}.`);
  };

  const removeOutgoingEdges = (sourceId: string) => {
    const outgoingCount = edges.filter((edge) => edge.source === sourceId).length;
    if (outgoingCount === 0) {
      setMessage(`No outgoing edges to remove from ${sourceId}.`);
      return;
    }
    setEdges((prev) => prev.filter((edge) => edge.source !== sourceId));
    setMessage(`Removed ${outgoingCount} outgoing edge(s) from ${sourceId}.`);
  };

  const resetDemo = () => {
    nextNodeId.current = editorInitialNodes.length + 1;
    nextEdgeId.current = editorInitialEdges.length + 1;
    setNodes(editorInitialNodes);
    setEdges(editorInitialEdges);
    setPositions(editorInitialPositions);
    setResetKey((k) => k + 1);
    setNextNodeShape("circle");
    setNextEdgeRoute("s-curved");
    setNextEdgeDashed(false);
    setMessage("Reset the graph editor demo.");
  };

  const handleCanvasDoubleClick = (graphX: number, graphY: number) => {
    addNodeAt(nextNodeShape, { x: graphX, y: graphY });
  };

  const handlePositionsChange = (nextPositions: Record<string, NodePosition>) => {
    setPositions((prev) => {
      const filtered: Record<string, NodePosition> = {};
      for (const node of nodes) {
        filtered[node.id] = nextPositions[node.id] ?? prev[node.id];
      }
      return filtered;
    });
  };

  const renderContextMenu = ({
    target,
    graphPosition,
    closeMenu,
  }: GraphContextMenuProps<EditorNodeData, EditorEdgeData>) => {
    const roundedPoint = `(${Math.round(graphPosition.x)}, ${Math.round(graphPosition.y)})`;

    if (target.kind === "canvas") {
      return (
        <DemoContextMenuFrame title="Canvas Menu" subtitle={`Add a node at ${roundedPoint}.`}>
          <DemoContextMenuButton
            label="Add circle node"
            onClick={() => { addNodeAt("circle", graphPosition); closeMenu(); }}
          />
          <DemoContextMenuButton
            label="Add rectangle node"
            onClick={() => { addNodeAt("rectangle", graphPosition); closeMenu(); }}
          />
        </DemoContextMenuFrame>
      );
    }

    if (target.kind === "node") {
      return (
        <DemoContextMenuFrame title="Node Menu" subtitle={`Target: ${target.node.data.label}`}>
          <DemoContextMenuButton
            label={target.node.data.shape === "circle" ? "Convert to rectangle" : "Convert to circle"}
            onClick={() => {
              updateNodeShape(target.node.id, target.node.data.shape === "circle" ? "rectangle" : "circle");
              closeMenu();
            }}
          />
          <DemoContextMenuButton
            label="Delete node"
            tone="danger"
            onClick={() => { removeNodeById(target.node.id); closeMenu(); }}
          />
        </DemoContextMenuFrame>
      );
    }

    if (target.kind === "port") {
      return (
        <DemoContextMenuFrame title="Port Menu" subtitle={`${target.port?.id ?? "port"} on ${target.node.data.label}`}>
          <DemoContextMenuButton
            label="Remove outgoing edges"
            onClick={() => { removeOutgoingEdges(target.node.id); closeMenu(); }}
          />
        </DemoContextMenuFrame>
      );
    }

    return (
      <DemoContextMenuFrame
        title="Edge Menu"
        subtitle={`${target.sourceNode.data.label} -> ${target.targetNode.data.label}`}
      >
        {EDGE_ROUTE_OPTIONS.map((route) => (
          <DemoContextMenuButton
            key={route}
            label={`Set ${getRouteLabel(route)}`}
            onClick={() => { updateEdgeRoute(target.edge.id, route); closeMenu(); }}
          />
        ))}
        <DemoContextMenuButton
          label={target.edge.data.dashed ? "Set solid stroke" : "Set dashed stroke"}
          onClick={() => { toggleEdgeDashed(target.edge.id); closeMenu(); }}
        />
        <DemoContextMenuButton
          label="Delete edge"
          tone="danger"
          onClick={() => { removeEdgeById(target.edge.id); closeMenu(); }}
        />
      </DemoContextMenuFrame>
    );
  };

  const circleCount = nodes.filter((node) => node.data.shape === "circle").length;
  const rectangleCount = nodes.length - circleCount;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gap: 16,
          marginBottom: 18,
          padding: 18,
          borderRadius: 22,
          background: "rgba(15, 23, 42, 0.72)",
          border: "1px solid rgba(148, 163, 184, 0.14)",
          color: "#cbd5e1",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Node to add on double-click:</div>
          <DemoTogglePill
            label="Circle"
            active={nextNodeShape === "circle"}
            onClick={() => setNextNodeShape("circle")}
          />
          <DemoTogglePill
            label="Rectangle"
            active={nextNodeShape === "rectangle"}
            onClick={() => setNextNodeShape("rectangle")}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Edge route for new connections:</div>
          {EDGE_ROUTE_OPTIONS.map((route) => (
            <DemoTogglePill
              key={route}
              label={getRouteLabel(route)}
              active={nextEdgeRoute === route}
              onClick={() => setNextEdgeRoute(route)}
            />
          ))}
          <DemoTogglePill
            label={nextEdgeDashed ? "Dashed" : "Solid"}
            active={nextEdgeDashed}
            onClick={() => setNextEdgeDashed((prev) => !prev)}
          />
          <DemoTogglePill label="Reset" active={false} onClick={resetDemo} />
        </div>
      </div>

      <GraphStage>
        <GraphCanvas<EditorNodeData, EditorEdgeData>
          key={resetKey}
          nodes={nodes}
          edges={edges}
          initialPositions={positions}
          layoutEnabled={false}
          getNodeRadius={getEditorNodeRadius}
          getNodeAnchor={getEditorNodeAnchor}
          getNodeShape={(node) => node.data.shape === "circle" ? "circle" : "rectangle"}
          renderNode={EditorNode}
          renderCanvasNode={renderEditorCanvasNode}
          getNodePorts={singleOutputPort}
          getNodeSize={getEditorNodeSize}
          renderPort={EditorConnectorHandle}
          renderContextMenu={renderContextMenu}
          onCanvasDoubleClick={handleCanvasDoubleClick}
          onConnect={handleConnect}
          onPositionsChange={handlePositionsChange}
          getEdgeRoute={({ edge, phase }) =>
            phase === "preview" ? nextEdgeRoute : edge?.data.route ?? "straight"
          }
          getEdgeCurveStrength={({ edge, phase }) =>
            getRouteCurveStrength(
              phase === "preview" ? nextEdgeRoute : edge?.data.route ?? "straight"
            )
          }
          getEdgeStyle={getEditorEdgeStyle}
        />
      </GraphStage>

      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{message}</div>
        <div style={{ fontSize: 14 }}>
          Nodes: <strong>{nodes.length}</strong> total,{" "}
          <strong>{circleCount}</strong> circle,{" "}
          <strong>{rectangleCount}</strong> rectangle
        </div>
        <div style={{ fontSize: 14 }}>
          Edges: <strong>{edges.length}</strong> total, next route{" "}
          <strong>{getRouteLabel(nextEdgeRoute)}</strong>, next stroke{" "}
          <strong>{nextEdgeDashed ? "dashed" : "solid"}</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Add: <strong>double-click blank canvas</strong> or{" "}
          <strong>right-click canvas</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Remove or change: <strong>right-click nodes, connectors, and edges</strong>
        </div>
      </InfoPanel>
    </div>
  );
}
