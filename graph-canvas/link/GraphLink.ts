/**
 * GraphLink — a lightweight coordinator that lets multiple <GraphCanvas>
 * instances interact WITHOUT sharing their internal state.
 *
 * Each graph keeps its own isolated Zustand store (positions / viewport /
 * selection). GraphLink sits ABOVE those stores and holds only cross-graph
 * *signals*: each graph publishes the shared "keys" of its selected and hovered
 * nodes, and every other graph reads those to decide what to highlight. It also
 * keeps a small registry of imperative handles so one graph can drive another
 * (e.g. `link.graph("B")?.panToNode(id)`).
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { GraphCanvasRef, Viewport } from "../types.js";

/** Describes a node dragged out of one graph and dropped onto another. */
export interface CrossDragPayload {
  sourceGraphId: string;
  /** Local node id in the source graph. */
  nodeId: string;
  /** Shared cross-graph key of the source node (via toLinkKey), if any. */
  key: string | null;
}

/** What each graph registers with the link so peers can locate and drive it. */
export interface GraphLinkRegistration {
  /** Imperative handle (fitToView / panTo / panToNode). */
  getHandle: () => GraphCanvasRef | null;
  /** The graph's container element, for screen↔graph coordinate mapping. */
  getContainer: () => HTMLElement | null;
  /** The graph's current pan/zoom. */
  getViewport: () => Viewport;
  /** Resolves the graph's current external-drop handler, or undefined if it
   *  doesn't accept drops. Read at drop time — a graph may gain or lose the
   *  handler long after it registered, so this must not be captured up front.
   *  Preferred over `onExternalDrop`. */
  getOnExternalDrop?: () => ExternalDropHandler | undefined;
  /**
   * @deprecated Captured once at registration, so it cannot reflect a handler
   * attached or removed later. Provide `getOnExternalDrop` instead; this is
   * still honoured as a fallback for registrations made before it existed.
   */
  onExternalDrop?: ExternalDropHandler;
}

/** Resolve a registration's drop handler, preferring the live getter. */
export function resolveExternalDropHandler(
  registration: GraphLinkRegistration
): ExternalDropHandler | undefined {
  return registration.getOnExternalDrop?.() ?? registration.onExternalDrop;
}

export type ExternalDropHandler = (
  payload: CrossDragPayload,
  graphX: number,
  graphY: number
) => void;

/** What a single graph publishes about itself for peers to react to. */
export interface GraphLinkPublish {
  /** Shared keys of this graph's currently-selected nodes. */
  selectedKeys: string[];
  /** Shared key of this graph's currently-hovered node, if any. */
  hoverKey: string | null;
}

export interface GraphLinkState {
  /** Per-graph published signals, keyed by graph id. Never holds a graph's
   *  own positions/viewport — isolation stays inside each graph's own store. */
  sources: Record<string, GraphLinkPublish>;
  publish: (graphId: string, data: GraphLinkPublish) => void;
  clear: (graphId: string) => void;
}

function samePublish(a: GraphLinkPublish | undefined, b: GraphLinkPublish): boolean {
  if (!a) return false;
  if (a.hoverKey !== b.hoverKey) return false;
  if (a.selectedKeys.length !== b.selectedKeys.length) return false;
  for (let i = 0; i < b.selectedKeys.length; i++) {
    if (a.selectedKeys[i] !== b.selectedKeys[i]) return false;
  }
  return true;
}

export interface GraphLink {
  /** Shared store of cross-graph signals. Subscribe with a selector. */
  store: StoreApi<GraphLinkState>;
  /** Register a graph so peers can locate/drive it. Returns an unregister fn. */
  register: (graphId: string, registration: GraphLinkRegistration) => () => void;
  /** Full registration of a graph, if currently registered. */
  getRegistration: (graphId: string) => GraphLinkRegistration | undefined;
  /** Imperative handle of another graph, if it is currently registered. */
  graph: (graphId: string) => GraphCanvasRef | null;
  /** Ids of all currently-registered graphs. */
  listGraphs: () => string[];
}

export function createGraphLink(): GraphLink {
  const registrations = new Map<string, GraphLinkRegistration>();

  const store = createStore<GraphLinkState>((set) => ({
    sources: {},
    publish: (graphId, data) =>
      set((s) => {
        if (samePublish(s.sources[graphId], data)) return s;
        return { sources: { ...s.sources, [graphId]: data } };
      }),
    clear: (graphId) =>
      set((s) => {
        if (!(graphId in s.sources)) return s;
        const next = { ...s.sources };
        delete next[graphId];
        return { sources: next };
      }),
  }));

  return {
    store,
    register(graphId, registration) {
      registrations.set(graphId, registration);
      return () => {
        // Only remove if this exact registration is still current, so a
        // StrictMode remount that re-registers first doesn't drop the new one.
        if (registrations.get(graphId) === registration) registrations.delete(graphId);
      };
    },
    getRegistration(graphId) {
      return registrations.get(graphId);
    },
    graph(graphId) {
      return registrations.get(graphId)?.getHandle() ?? null;
    },
    listGraphs() {
      return [...registrations.keys()];
    },
  };
}
