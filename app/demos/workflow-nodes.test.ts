import { describe, expect, it } from "vitest";
import { createConnectionValidator } from "../../graph-canvas/validation";
import type { GraphEdge, GraphNode, PortDef } from "../../graph-canvas/types";
import { AGENT_PORTS, EVAL_PORTS } from "./workflow-nodes";

const port = (ports: typeof AGENT_PORTS, id: string) =>
  ports.find((candidate) => candidate.id === id);

describe("workflow resource capacities", () => {
  it("allows several tools but keeps singular agent resources capped", () => {
    expect(port(AGENT_PORTS, "tool")?.maxConnections).toBeUndefined();
    expect(port(AGENT_PORTS, "model")?.maxConnections).toBe(1);
    expect(port(AGENT_PORTS, "memory")?.maxConnections).toBe(1);
    expect(port(EVAL_PORTS, "output-parser")?.maxConnections).toBe(1);
  });

  it("allows a second tool provider onto an occupied agent Tool endpoint", () => {
    const providesTool: PortDef = { id: "provides", type: "tool", mode: "output" };
    const nodes: GraphNode<{ ports: PortDef[] }>[] = [
      { id: "serp-tool", data: { ports: [providesTool] } },
      { id: "code-tool", data: { ports: [providesTool] } },
      { id: "refiner-agent", data: { ports: AGENT_PORTS } },
    ];
    const edges: GraphEdge<unknown>[] = [
      {
        id: "existing-tool",
        source: "serp-tool",
        sourcePort: "provides",
        target: "refiner-agent",
        targetPort: "tool",
        data: null,
      },
    ];
    const validate = createConnectionValidator({
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      getNodePorts: (node) => node.data.ports,
      edges,
    });

    expect(validate({
      source: "code-tool",
      sourcePort: "provides",
      target: "refiner-agent",
      targetPort: "tool",
    })).toBe(true);
  });
});
