"use client";

import { useState } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { GraphContextMenuProps, GraphEdge } from "@/graph-canvas";
import {
  GraphStage,
  SourceConnectorHandle,
  singleOutputPort,
  InfoPanel,
  DemoContextMenuFrame,
  DemoContextMenuButton,
} from "./_shared/ui";
import { CircleNode } from "./_shared/node-renderers";
import { renderCircleCanvasNode } from "./_shared/canvas-renderers";
import {
  contextMenuNodes,
  contextMenuEdges,
  contextMenuPositions,
  CIRCLE_RADIUS,
} from "./_shared/data";
import type { CircleNodeData, DemoEdgeData } from "./_shared/data";

const renderPort = () => <SourceConnectorHandle />;

export function ContextMenusDemo() {
  const [edges, setEdges] = useState(contextMenuEdges);
  const [message, setMessage] = useState(
    "Right-click a node, connector port, edge, or empty canvas. The graph keeps exactly one managed menu open."
  );


  const renderContextMenu = ({
    target,
    graphPosition,
    closeMenu,
  }: GraphContextMenuProps<CircleNodeData, DemoEdgeData>) => {
    const roundedPoint = `(${Math.round(graphPosition.x)}, ${Math.round(graphPosition.y)})`;

    if (target.kind === "canvas") {
      return (
        <DemoContextMenuFrame
          title="Canvas Menu"
          subtitle={`Background menu at graph point ${roundedPoint}.`}
        >
          <DemoContextMenuButton
            label="Inspect blank canvas"
            onClick={() => {
              setMessage(`Canvas context menu opened at ${roundedPoint}.`);
              closeMenu();
            }}
          />
        </DemoContextMenuFrame>
      );
    }

    if (target.kind === "node") {
      return (
        <DemoContextMenuFrame
          title="Node Menu"
          subtitle={`Target: ${target.node.data.label}`}
        >
          <DemoContextMenuButton
            label={`Inspect ${target.node.data.label}`}
            onClick={() => {
              setMessage(`Node menu action on ${target.node.id}.`);
              closeMenu();
            }}
          />
        </DemoContextMenuFrame>
      );
    }

    if (target.kind === "port") {
      return (
        <DemoContextMenuFrame
          title="Port Menu"
          subtitle={`${target.port?.id ?? "port"} on ${target.node.data.label}`}
        >
          <DemoContextMenuButton
            label={`Inspect ${target.node.data.label} port`}
            onClick={() => {
              setMessage(`Port menu action on ${target.node.id}.`);
              closeMenu();
            }}
          />
        </DemoContextMenuFrame>
      );
    }

    return (
      <DemoContextMenuFrame
        title="Edge Menu"
        subtitle={`${target.sourceNode.data.label} -> ${target.targetNode.data.label}`}
      >
        <DemoContextMenuButton
          label={`Inspect ${target.edge.data.label}`}
          onClick={() => {
            setMessage(`Edge menu action on ${target.edge.id}.`);
            closeMenu();
          }}
        />
        <DemoContextMenuButton
          label="Delete edge"
          tone="danger"
          onClick={() => {
            setEdges((prev: GraphEdge<DemoEdgeData>[]) =>
              prev.filter((edge) => edge.id !== target.edge.id)
            );
            setMessage(`Deleted edge ${target.edge.id}.`);
            closeMenu();
          }}
        />
      </DemoContextMenuFrame>
    );
  };

  return (
    <div>
      <GraphStage>
        <GraphCanvas<CircleNodeData, DemoEdgeData>
          nodes={contextMenuNodes}
          edges={edges}
          initialPositions={contextMenuPositions}
          layoutEnabled={false}
          getNodeRadius={() => CIRCLE_RADIUS}
          renderNode={CircleNode}
          renderCanvasNode={renderCircleCanvasNode}
          getNodePorts={singleOutputPort}
          getNodeSize={() => ({ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 })}
          renderPort={renderPort}
          renderContextMenu={renderContextMenu}
        />
      </GraphStage>
      <InfoPanel>
        <div style={{ fontSize: 14, color: "#93c5fd" }}>{message}</div>
        <div style={{ fontSize: 14 }}>
          Targets: <strong>node</strong>, <strong>port</strong>,{" "}
          <strong>edge</strong>, <strong>canvas</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Managed by the library: <strong>only one menu is open at a time</strong>
        </div>
        <div style={{ fontSize: 14 }}>
          Remaining edges: <strong>{edges.length}</strong>
        </div>
      </InfoPanel>
    </div>
  );
}
