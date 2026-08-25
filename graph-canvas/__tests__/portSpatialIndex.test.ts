import { describe, it, expect } from "vitest";
import { SpatialIndex } from "../spatialIndex";
import type { GraphNode, NodePosition, PortDef } from "../types";

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
];

const positions: Record<string, NodePosition> = {
  a: { x: 0, y: 0 },
  b: { x: 400, y: 0 },
};

// 200x100 box: left port at (-100, 0), right port at (+100, 0).
const SIZE = { width: 200, height: 100 };
const ports: PortDef[] = [
  { id: "in", type: "main", mode: "input" },
  { id: "out", type: "main", mode: "output" },
];

function makeIndex(getNodePorts: (n: GraphNode<Data>) => PortDef[] = () => ports) {
  const index = new SpatialIndex<Data>();
  index.configurePorts(getNodePorts, () => SIZE);
  index.rebuild(nodes, positions, () => 50);
  return index;
}

describe("SpatialIndex — port hit-testing", () => {
  it("returns null when ports are not configured at all", () => {
    // No configurePorts call — the port tree must stay empty so plain graphs
    // pay nothing for the feature.
    const index = new SpatialIndex<Data>();
    index.rebuild(nodes, positions, () => 50);
    expect(index.nearestPort(100, 0, 30)).toBeNull();
  });

  it("returns null when the port fn is explicitly undefined", () => {
    const index = new SpatialIndex<Data>();
    index.configurePorts(undefined, () => SIZE);
    index.rebuild(nodes, positions, () => 50);
    expect(index.nearestPort(100, 0, 30)).toBeNull();
  });

  it("finds the port nearest a point", () => {
    const index = makeIndex();
    // Node a's output port sits at (100, 0).
    const hit = index.nearestPort(102, 3, 30);
    expect(hit).toMatchObject({ nodeId: "a", portId: "out" });
  });

  it("respects the search radius", () => {
    const index = makeIndex();
    expect(index.nearestPort(100, 0, 30)).not.toBeNull();
    // 60px away from any port, with a 20px radius.
    expect(index.nearestPort(160, 0, 20)).toBeNull();
  });

  it("prefers the closer of two candidates", () => {
    const index = makeIndex();
    // Node b's input port is at (300, 0); node a's output at (100, 0).
    expect(index.nearestPort(290, 0, 60)).toMatchObject({ nodeId: "b", portId: "in" });
  });

  it("excludes the drag's own source node", () => {
    const index = makeIndex();
    expect(index.nearestPort(100, 0, 30, "a")).toBeNull();
  });

  it("skips candidates the accept predicate rejects, falling through to a valid one", () => {
    const index = makeIndex();
    // Nearest to 150 is a/out (50 away); b/in is 150 away. Reject a/out and the
    // search must not stop there — it should keep looking within the radius.
    const hit = index.nearestPort(150, 0, 200, undefined, (h) => h.portId !== "out");
    expect(hit).toMatchObject({ nodeId: "b", portId: "in" });
  });

  it("carries the port definition on the hit", () => {
    const index = makeIndex();
    expect(index.nearestPort(100, 0, 30)?.port).toMatchObject({ id: "out", type: "main" });
  });
});

describe("SpatialIndex — port/node consistency", () => {
  it("moves port hit-boxes when the node moves", () => {
    const index = makeIndex();
    expect(index.nearestPort(100, 0, 20)).not.toBeNull();

    index.update(nodes[0], { x: 1000, y: 1000 }, () => 50);

    // Old location is now empty...
    expect(index.nearestPort(100, 0, 20)).toBeNull();
    // ...and the port followed the node (1000+100, 1000).
    expect(index.nearestPort(1100, 1000, 20)).toMatchObject({ nodeId: "a", portId: "out" });
  });

  it("keeps ports in sync through updateBatch", () => {
    const index = makeIndex();
    index.updateBatch(nodes, { a: { x: 0, y: 500 }, b: { x: 400, y: 0 } }, () => 50);
    expect(index.nearestPort(100, 500, 20)).toMatchObject({ nodeId: "a", portId: "out" });
    expect(index.nearestPort(100, 0, 20)).toBeNull();
  });

  it("drops ports when the node is removed", () => {
    const index = makeIndex();
    index.remove(["a"]);
    expect(index.nearestPort(100, 0, 20)).toBeNull();
    // Node b is untouched.
    expect(index.nearestPort(300, 0, 20)).toMatchObject({ nodeId: "b" });
  });

  it("clears stale ports on a full rebuild", () => {
    const index = makeIndex();
    index.rebuild([nodes[1]], positions, () => 50);
    expect(index.nearestPort(100, 0, 20)).toBeNull();
    expect(index.nearestPort(300, 0, 20)).toMatchObject({ nodeId: "b" });
  });

  it("does not double-insert when the same node is updated twice", () => {
    const index = makeIndex();
    index.update(nodes[0], { x: 0, y: 0 }, () => 50);
    index.update(nodes[0], { x: 0, y: 0 }, () => 50);
    // A duplicated entry would still resolve, so assert on the node index too:
    // both trees must agree that there is exactly one node "a" here.
    expect(index.search({ minX: -1, minY: -1, maxX: 1, maxY: 1 }).filter((i) => i.id === "a"))
      .toHaveLength(1);
    expect(index.nearestPort(100, 0, 20)).toMatchObject({ nodeId: "a", portId: "out" });
  });

  it("handles nodes with no ports alongside nodes with ports", () => {
    const index = new SpatialIndex<Data>();
    index.configurePorts((n) => (n.id === "a" ? ports : []), () => SIZE);
    index.rebuild(nodes, positions, () => 50);
    expect(index.nearestPort(100, 0, 20)).toMatchObject({ nodeId: "a" });
    expect(index.nearestPort(300, 0, 20)).toBeNull();
  });
});
