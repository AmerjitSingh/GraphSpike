import type {
  Connection,
  ConnectionContext,
  GraphEdge,
  GraphNode,
  PortDef,
} from "./types.js";
import { findPort, resolveNodePorts } from "./ports.js";

/** True when `port` still has room for another edge. Ports without an explicit
 *  `maxConnections` are unlimited, and a connection that doesn't name a port
 *  has no cardinality to check. */
export function hasCapacity<E>(
  edges: readonly GraphEdge<E>[],
  port: PortDef | undefined,
  nodeId: string,
  portId: string | undefined,
  end: "source" | "target"
): boolean {
  if (!port || port.maxConnections === undefined || !portId) return true;
  let used = 0;
  for (const edge of edges) {
    const matches =
      end === "source"
        ? edge.source === nodeId && edge.sourcePort === portId
        : edge.target === nodeId && edge.targetPort === portId;
    if (matches) used++;
  }
  return used < port.maxConnections;
}

export interface ConnectionValidatorOptions<T, E> {
  nodeById: Map<string, GraphNode<T>>;
  getNodePorts?: (node: GraphNode<T>) => PortDef[];
  /** Existing edges — used to enforce port `maxConnections`. Omit to opt out of
   *  cardinality enforcement entirely. */
  edges?: readonly GraphEdge<E>[];
  isValidConnection?: (connection: ConnectionContext<T>) => boolean;
}

/**
 * Build the single authority on whether a proposed connection may be made.
 *
 * Every path that can create an edge — pointer drag, keyboard connect — runs
 * through this, so the rules can't drift between them. Order matters: the
 * library's own structural rules run first and are not overridable, then the
 * consumer's `isValidConnection` gets the final say on domain rules.
 *
 * Structural rules:
 *  1. Both endpoints must be real nodes.
 *  2. An end whose node offers a port *for that direction* must name one.
 *     Without this a rejected or full port silently degrades into a node-level
 *     connection whose `sourcePort`/`targetPort` is undefined — which bypasses
 *     `maxConnections` (it has no port to count against) and, because the
 *     resulting edge is itself portless, is never counted afterwards either.
 *     The check is per-direction on purpose: a node that declares only output
 *     ports still accepts an incoming edge at its perimeter, which is what
 *     output-only registries (see `singleOutputPort` in the demos) rely on.
 *  3. Edges run output → input. `mode` is the library's own concept, so this
 *     is its rule to enforce; leaving it to consumers means every one of them
 *     hand-writes the same check, and any path that has to *choose* a port
 *     (the keyboard connect) has nothing to steer by.
 *  4. Two ports may only connect when their `type` matches — the contract
 *     `PortDef.type` already documents. Only checked when both ends resolve to
 *     a port; a perimeter end has no type to compare.
 *  5. Neither end may exceed its port's `maxConnections`.
 */
export function createConnectionValidator<T, E>({
  nodeById,
  getNodePorts,
  edges,
  isValidConnection,
}: ConnectionValidatorOptions<T, E>): (connection: Connection) => boolean {
  return (connection: Connection): boolean => {
    const sourceNode = nodeById.get(connection.source);
    const targetNode = nodeById.get(connection.target);
    if (!sourceNode || !targetNode) return false;

    const sourcePorts = resolveNodePorts(sourceNode, getNodePorts);
    const targetPorts = resolveNodePorts(targetNode, getNodePorts);

    // A node must be connected through one of its ports when it actually
    // offers one for this direction. Checking `ports.length` alone would break
    // output-only (or input-only) registries: an output-only node has nothing
    // an incoming edge could legally land on, so demanding a target port there
    // makes every connection impossible.
    const hasOutputs = sourcePorts.some((p) => p.mode === "output");
    const hasInputs = targetPorts.some((p) => p.mode === "input");
    if (hasOutputs && !connection.sourcePort) return false;
    if (hasInputs && !connection.targetPort) return false;

    const sourcePortDef = findPort(sourcePorts, connection.sourcePort);
    const targetPortDef = findPort(targetPorts, connection.targetPort);

    // A named port that doesn't exist on the node is a stale or hand-written
    // id, not a perimeter connection.
    if (connection.sourcePort && !sourcePortDef) return false;
    if (connection.targetPort && !targetPortDef) return false;

    // Edges leave through an output and arrive at an input.
    if (sourcePortDef && sourcePortDef.mode !== "output") return false;
    if (targetPortDef && targetPortDef.mode !== "input") return false;

    // Typed ports only connect to their own type.
    if (sourcePortDef && targetPortDef && sourcePortDef.type !== targetPortDef.type) return false;

    // Cardinality is the library's business, not the consumer's: it is
    // derivable from the port definition plus the current edge list.
    if (edges) {
      if (!hasCapacity(edges, sourcePortDef, connection.source, connection.sourcePort, "source")) {
        return false;
      }
      if (!hasCapacity(edges, targetPortDef, connection.target, connection.targetPort, "target")) {
        return false;
      }
    }

    if (!isValidConnection) return true;
    return isValidConnection({
      ...connection,
      sourceNode,
      targetNode,
      sourcePortDef,
      targetPortDef,
    });
  };
}
