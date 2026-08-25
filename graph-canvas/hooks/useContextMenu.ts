"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, MouseEvent } from "react";
import { zoomTransform } from "d3-zoom";
import type {
  GraphContextMenuProps,
  GraphContextMenuTarget,
  GraphEdge,
  GraphNode,
  NodePosition,
  NodeSize,
  PortDef,
  Viewport,
} from "../types.js";
import { getPortPosition, resolveNodeSize } from "../ports.js";

type ContextMenuState<T, E> = Omit<GraphContextMenuProps<T, E>, "closeMenu">;

interface UseContextMenuProps<T, E> {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  renderContextMenu?: (props: GraphContextMenuProps<T, E>) => React.ReactNode | null;
  nodeById: Map<string, GraphNode<T>>;
  edgeById: Map<string, GraphEdge<E>>;
  nodePositions: Record<string, NodePosition>;
  /** Port lookup, so a port menu can report the port's own graph position. */
  getNodePorts?: (node: GraphNode<T>) => PortDef[];
  getNodeSize?: (node: GraphNode<T>) => NodeSize;
}

/**
 * Manages a single context menu that can be opened on the canvas, nodes, edges,
 * or connector handles. Handles dismissal via click-outside, Escape, resize, and scroll.
 */
export function useContextMenu<T, E>({
  containerRef,
  viewport,
  renderContextMenu,
  nodeById,
  edgeById,
  nodePositions,
  getNodePorts,
  getNodeSize,
}: UseContextMenuProps<T, E>) {
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState<T, E> | null>(null);
  /** Viewport as of the moment the menu opened (or the latest while closed). */
  const viewportWhileClosedRef = useRef(viewport);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  /** Reads the live d3 pan/zoom via the public zoomTransform API.
   *  The React store lags it by up to one animation frame.
   *
   *  Returns null when d3 hasn't bound this element yet. That check matters:
   *  `zoomTransform` reports the *identity* transform for an unbound node
   *  rather than failing, so without it the caller's `?? viewport` fallback
   *  could never fire and a real viewport would be silently replaced by 1:1. */
  const readLiveViewport = useCallback((): Viewport | null => {
    const el = containerRef.current;
    // d3-zoom stores its transform on the node as `__zoom` when it binds.
    if (!el || !("__zoom" in el)) return null;
    const t = zoomTransform(el);
    return { x: t.x, y: t.y, zoom: t.k };
  }, [containerRef]);

  const getMenuPositions = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      // Map through the live transform: the store can be up to one frame behind
      // (RAF-deferred), which would place graphPosition at the pre-zoom point.
      const vp = readLiveViewport() ?? viewport;
      return {
        containerPosition: {
          x: clientX - rect.left,
          y: clientY - rect.top,
        },
        clientPosition: { x: clientX, y: clientY },
        graphPosition: {
          x: (clientX - rect.left - vp.x) / vp.zoom,
          y: (clientY - rect.top - vp.y) / vp.zoom,
        },
      };
    },
    [containerRef, viewport, readLiveViewport]
  );

  const getMenuPositionsAtGraphPosition = useCallback(
    (graphPosition: NodePosition) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const vp = readLiveViewport() ?? viewport;
      const containerPosition = {
        x: graphPosition.x * vp.zoom + vp.x,
        y: graphPosition.y * vp.zoom + vp.y,
      };
      return {
        containerPosition,
        clientPosition: {
          x: rect.left + containerPosition.x,
          y: rect.top + containerPosition.y,
        },
        graphPosition: { x: graphPosition.x, y: graphPosition.y },
      };
    },
    [containerRef, viewport, readLiveViewport]
  );

  const openContextMenu = useCallback(
    (
      target: GraphContextMenuTarget<T, E>,
      event: Pick<MouseEvent, "clientX" | "clientY">
    ) => {
      if (!renderContextMenu) return;
      const menuPositions = getMenuPositions(event.clientX, event.clientY);
      if (!menuPositions) return;
      // Anchor the dismiss-on-viewport-change check to d3's LIVE transform, not
      // the last committed store value. Viewport writes are RAF-deferred, so a
      // zoom/pan that happened just before this open would otherwise land after
      // it and dismiss the menu the instant it appears.
      viewportWhileClosedRef.current = readLiveViewport() ?? viewport;
      setContextMenu({ target, ...menuPositions });
    },
    [getMenuPositions, renderContextMenu, readLiveViewport, viewport]
  );

  /** Opens a menu at visual graph geometry instead of event coordinates.
   *  Keyboard context-menu events commonly report (0, 0), so their semantic
   *  target must supply the anchor explicitly. */
  const openContextMenuAtGraphPosition = useCallback(
    (target: GraphContextMenuTarget<T, E>, graphPosition: NodePosition) => {
      if (!renderContextMenu) return;
      const menuPositions = getMenuPositionsAtGraphPosition(graphPosition);
      if (!menuPositions) return;
      viewportWhileClosedRef.current = readLiveViewport() ?? viewport;
      setContextMenu({ target, ...menuPositions });
    },
    [getMenuPositionsAtGraphPosition, renderContextMenu, readLiveViewport, viewport]
  );

  // Dismiss on click-outside, Escape, resize, or scroll.
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        contextMenuRef.current &&
        event.target instanceof Node &&
        contextMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    const handleWindowChange = () => setContextMenu(null);

    // Scroll is listened to in the capture phase (scroll events don't bubble),
    // which also delivers scrolls that ORIGINATE inside the menu — a long,
    // scrollable menu must not dismiss itself the moment the user scrolls it.
    const handleScroll = (event: Event) => {
      if (
        contextMenuRef.current &&
        event.target instanceof Node &&
        contextMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  // Dismiss when the canvas viewport pans/zooms under the menu — wheel zoom
  // fires none of the window-level events above, so track the viewport itself.
  //
  // Both sides of this comparison read the LIVE d3 transform. The React
  // viewport only serves as the trigger: it lags by up to a frame, so
  // comparing the live open-time value against it would flag a zoom that
  // happened *before* the menu opened and dismiss it on sight.
  useEffect(() => {
    const live = readLiveViewport() ?? viewport;
    if (!contextMenu) {
      viewportWhileClosedRef.current = live;
      return;
    }
    const opened = viewportWhileClosedRef.current;
    if (opened.x !== live.x || opened.y !== live.y || opened.zoom !== live.zoom) {
      setContextMenu(null);
    }
  }, [contextMenu, viewport, readLiveViewport]);

  const handleCanvasContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!renderContextMenu) return;
      if ((e.target as HTMLElement).closest("[data-gc-context-menu]")) return;
      e.preventDefault();
      openContextMenu({ kind: "canvas" }, e);
    },
    [openContextMenu, renderContextMenu]
  );

  const handleNodeContextMenu = useCallback(
    (id: string, e: MouseEvent) => {
      if (!renderContextMenu) return;
      const node = nodeById.get(id);
      const position = nodePositions[id];
      if (!node || !position) return;
      openContextMenu({ kind: "node", node, position }, e);
    },
    [nodeById, nodePositions, openContextMenu, renderContextMenu]
  );

  const handlePortContextMenu = useCallback(
    (id: string, e: MouseEvent, port?: PortDef, graphAnchor?: NodePosition) => {
      if (!renderContextMenu) return;
      const node = nodeById.get(id);
      const position = nodePositions[id];
      if (!node || !position) return;
      // Resolve the port's own graph-space centre so a menu that creates a node
      // can place it under the port rather than the middle of the node.
      const portPosition =
        port && getNodePorts
          ? getPortPosition(
              position,
              resolveNodeSize(node, getNodeSize),
              getNodePorts(node),
              port.id
            ) ?? undefined
          : undefined;
      const target: GraphContextMenuTarget<T, E> = {
        kind: "port",
        node,
        port,
        position,
        portPosition,
      };
      // Pointer context menus follow the pointer. The endpoint button is also
      // keyboard-operable, however, and synthetic clicks report (0, 0), so its
      // caller supplies the exact port centre in graph space.
      if (graphAnchor) openContextMenuAtGraphPosition(target, graphAnchor);
      else openContextMenu(target, e);
    },
    [
      nodeById,
      nodePositions,
      openContextMenu,
      openContextMenuAtGraphPosition,
      renderContextMenu,
      getNodePorts,
      getNodeSize,
    ]
  );

  const handleEdgeContextMenu = useCallback(
    (id: string, e: MouseEvent) => {
      if (!renderContextMenu) return;
      const edge = edgeById.get(id);
      if (!edge) return;
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) return;
      openContextMenu(
        { kind: "edge", edge: edge as GraphEdge<E>, sourceNode, targetNode },
        e
      );
    },
    [edgeById, nodeById, openContextMenu, renderContextMenu]
  );

  const openNodeContextMenuAt = useCallback(
    (id: string, graphPosition: NodePosition) => {
      if (!renderContextMenu) return;
      const node = nodeById.get(id);
      const position = nodePositions[id];
      if (!node || !position) return;
      openContextMenuAtGraphPosition({ kind: "node", node, position }, graphPosition);
    },
    [nodeById, nodePositions, openContextMenuAtGraphPosition, renderContextMenu]
  );

  const openEdgeContextMenuAt = useCallback(
    (id: string, graphPosition: NodePosition) => {
      if (!renderContextMenu) return;
      const edge = edgeById.get(id);
      if (!edge) return;
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) return;
      openContextMenuAtGraphPosition(
        { kind: "edge", edge: edge as GraphEdge<E>, sourceNode, targetNode },
        graphPosition
      );
    },
    [edgeById, nodeById, openContextMenuAtGraphPosition, renderContextMenu]
  );

  return {
    contextMenuRef,
    contextMenu,
    closeContextMenu,
    handleCanvasContextMenu,
    handleNodeContextMenu,
    handlePortContextMenu,
    handleEdgeContextMenu,
    openNodeContextMenuAt,
    openEdgeContextMenuAt,
  };
}
