import { describe, it, expect, vi } from "vitest";
import { createConnectionValidator, hasCapacity } from "../validation";
import type { ConnectionContext, GraphEdge, GraphNode, PortDef } from "../types";

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];
const nodeById = new Map(nodes.map((n) => [n.id, n]));

const OUT: PortDef = { id: "out", type: "main", mode: "output" };
const IN_ONCE: PortDef = { id: "in", type: "main", mode: "input", maxConnections: 1 };
const IN_FREE: PortDef = { id: "in", type: "main", mode: "input" };

const ports = (...defs: PortDef[]) => () => defs;

describe("hasCapacity", () => {
  const edges: GraphEdge<unknown>[] = [
    { id: "e1", source: "a", target: "b", data: {}, sourcePort: "out", targetPort: "in" },
  ];

  it("is unlimited when the port has no maxConnections", () => {
    expect(hasCapacity(edges, IN_FREE, "b", "in", "target")).toBe(true);
  });

  it("is unlimited when there is no port def", () => {
    expect(hasCapacity(edges, undefined, "b", "in", "target")).toBe(true);
  });

  it("counts only edges landing on the same node and port", () => {
    expect(hasCapacity(edges, IN_ONCE, "b", "in", "target")).toBe(false);
    // Same port id, different node.
    expect(hasCapacity(edges, IN_ONCE, "a", "in", "target")).toBe(true);
  });

  it("counts each end independently", () => {
    // b/in is full as a *target*, but nothing leaves b through it, so the same
    // node+port still has room as a source.
    expect(hasCapacity(edges, IN_ONCE, "b", "in", "target")).toBe(false);
    expect(hasCapacity(edges, IN_ONCE, "b", "in", "source")).toBe(true);
  });

  it("cannot count anything without a port id", () => {
    // This is exactly why a portless connection must be rejected earlier:
    // there is no port to count against, so capacity is vacuously true.
    expect(hasCapacity(edges, IN_ONCE, "b", undefined, "target")).toBe(true);
  });
});

describe("createConnectionValidator", () => {
  it("rejects a connection naming an unknown node", () => {
    const validate = createConnectionValidator<Data, unknown>({ nodeById });
    expect(validate({ source: "a", target: "ghost" })).toBe(false);
    expect(validate({ source: "ghost", target: "b" })).toBe(false);
  });

  it("allows a portless connection between nodes that have no ports", () => {
    const validate = createConnectionValidator<Data, unknown>({ nodeById });
    expect(validate({ source: "a", target: "b" })).toBe(true);
  });

  it("requires a port on any end whose node defines ports", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
    });
    expect(validate({ source: "a", target: "b" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "out", target: "b" })).toBe(false);
    expect(validate({ source: "a", target: "b", targetPort: "in" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "in" })).toBe(true);
  });

  it("connects an output-only registry at the target perimeter", () => {
    // Regression: the demos' `singleOutputPort` gives every node one output
    // port and nothing else. Requiring a target port whenever the node has
    // *any* port made connection creation impossible in five shipped demos.
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT),
    });
    expect(validate({ source: "a", sourcePort: "out", target: "b" })).toBe(true);
    // The source still has to name its output — that end does offer one.
    expect(validate({ source: "a", target: "b" })).toBe(false);
  });

  it("still requires a target port once the node offers an input", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
    });
    expect(validate({ source: "a", sourcePort: "out", target: "b" })).toBe(false);
  });

  it("connects an input-only target from a portless source", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(IN_FREE),
    });
    expect(validate({ source: "a", target: "b", targetPort: "in" })).toBe(true);
  });

  it("only connects ports of the same type", () => {
    const model: PortDef = { id: "provides", type: "model", mode: "output" };
    const memoryIn: PortDef = { id: "memory", type: "memory", mode: "input" };
    const modelIn: PortDef = { id: "model", type: "model", mode: "input" };
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: () => [model, memoryIn, modelIn],
    });
    expect(validate({ source: "a", sourcePort: "provides", target: "b", targetPort: "memory" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "provides", target: "b", targetPort: "model" })).toBe(true);
  });

  it("rejects a port id the node does not actually define", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
    });
    expect(validate({ source: "a", sourcePort: "nope", target: "b", targetPort: "in" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "nope" })).toBe(false);
  });

  it("enforces output -> input direction", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
    });
    // Leaving through an input, or arriving at an output, is malformed.
    expect(validate({ source: "a", sourcePort: "in", target: "b", targetPort: "in" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "out" })).toBe(false);
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "in" })).toBe(true);
  });

  it("enforces maxConnections once the port is full", () => {
    const edges: GraphEdge<unknown>[] = [
      { id: "e1", source: "a", target: "b", data: {}, sourcePort: "out", targetPort: "in" },
    ];
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_ONCE),
      edges,
    });
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "in" })).toBe(false);
  });

  it("skips cardinality entirely when no edge list is supplied", () => {
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_ONCE),
    });
    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "in" })).toBe(true);
  });

  it("gives isValidConnection the resolved port defs and the last word", () => {
    const isValidConnection = vi.fn<(c: ConnectionContext<Data>) => boolean>(() => false);
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
      isValidConnection,
    });

    expect(validate({ source: "a", sourcePort: "out", target: "b", targetPort: "in" })).toBe(false);
    expect(isValidConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "a",
        target: "b",
        sourceNode: nodes[0],
        targetNode: nodes[1],
        sourcePortDef: OUT,
        targetPortDef: IN_FREE,
      })
    );
  });

  it("does not consult isValidConnection once a structural rule has failed", () => {
    const isValidConnection = vi.fn<(c: ConnectionContext<Data>) => boolean>(() => true);
    const validate = createConnectionValidator<Data, unknown>({
      nodeById,
      getNodePorts: ports(OUT, IN_FREE),
      isValidConnection,
    });
    // Portless against a ported node — the consumer must not be able to
    // approve a connection the library considers malformed.
    expect(validate({ source: "a", target: "b" })).toBe(false);
    expect(isValidConnection).not.toHaveBeenCalled();
  });
});
