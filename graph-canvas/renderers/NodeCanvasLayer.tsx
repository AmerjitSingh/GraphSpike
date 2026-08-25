"use client";

import { memo, useLayoutEffect, useRef } from "react";
import type {
    GraphNode,
    NodePosition,
    NodeSize,
    PortDef,
    RenderCanvasPortProps,
    Viewport,
} from "../types.js";
import { getVisibleGraphRect, resolveNodeShape } from "../geometry.js";
import { RECT_H, RECT_RADIUS, RECT_W } from "../constants.js";
import {
    PORT_BAR_HEIGHT,
    PORT_BAR_WIDTH,
    PORT_SIZE,
    getPortGlyph,
    getPortPositions,
    getPortSide,
    resolveNodePorts,
    resolveNodeSize,
} from "../ports.js";

/** Helper to extract a string property from node.data without `as any`. */
function getDataString<T>(data: T, key: string): string | undefined {
    if (data != null && typeof data === "object" && key in (data as Record<string, unknown>)) {
        const val = (data as Record<string, unknown>)[key];
        return typeof val === "string" ? val : undefined;
    }
    return undefined;
}

/** Extra half-extent allowed for labels, borders and the highlight ring. */
const CULL_PAD = 24;

/** Polyfill-safe rounded rectangle. Falls back to a plain rect on older browsers. */
function drawRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) {
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, r);
    } else {
        // Fallback: manually draw a rounded rectangle path.
        const clampedR = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + clampedR, y);
        ctx.arcTo(x + w, y, x + w, y + h, clampedR);
        ctx.arcTo(x + w, y + h, x, y + h, clampedR);
        ctx.arcTo(x, y + h, x, y, clampedR);
        ctx.arcTo(x, y, x + w, y, clampedR);
        ctx.closePath();
    }
}

export interface RenderCanvasNodeProps<T> {
    ctx: CanvasRenderingContext2D;
    node: GraphNode<T>;
    x: number;
    y: number;
    radius: number;
    zoom: number;
}

interface NodeCanvasLayerProps<T> {
    nodes: GraphNode<T>[];
    positions: Record<string, NodePosition>;
    viewport: Viewport;
    width: number;
    height: number;
    getNodeRadius: (node: GraphNode<T>) => number;
    getNodeShape?: (node: GraphNode<T>) => string;
    /** Custom canvas rendering for each unselected node. Return `true` to skip default drawing. */
    renderCanvasNode?: (props: RenderCanvasNodeProps<T>) => boolean | void;
    /** Typed ports to draw on unselected nodes. */
    getNodePorts?: (node: GraphNode<T>) => PortDef[];
    getNodeSize?: (node: GraphNode<T>) => NodeSize;
    /** Custom canvas rendering for a port. Return `true` to skip default drawing. */
    renderCanvasPort?: (props: RenderCanvasPortProps<T>) => boolean | void;
    selectedNodeIds: string[];
    /** Node ids to draw with a highlight ring (e.g. cross-graph linking). */
    highlightedNodeIds?: string[];
    /** Node holding the roving keyboard focus. Unselected nodes live on this
     *  layer, so without a ring here a keyboard user has no idea where they
     *  are — the layer is aria-hidden raster. */
    focusedNodeId?: string | null;
    /** Node a keyboard connect was armed from. */
    connectFromId?: string | null;
}

export const NodeCanvasLayer = memo(function NodeCanvasLayer<T>({
    nodes,
    positions,
    viewport,
    width,
    height,
    getNodeRadius,
    getNodeShape,
    renderCanvasNode,
    getNodePorts,
    getNodeSize,
    renderCanvasPort,
    selectedNodeIds,
    highlightedNodeIds,
    focusedNodeId,
    connectFromId,
}: NodeCanvasLayerProps<T>) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Snapshot the latest callbacks so the draw effect reads consistent values
    // during paint, even when a parent rerender swaps implementations.
    const renderCanvasNodeRef = useRef(renderCanvasNode);
    renderCanvasNodeRef.current = renderCanvasNode;
    const getNodeShapeRef = useRef(getNodeShape);
    getNodeShapeRef.current = getNodeShape;
    const getNodeRadiusRef = useRef(getNodeRadius);
    getNodeRadiusRef.current = getNodeRadius;
    const getNodePortsRef = useRef(getNodePorts);
    getNodePortsRef.current = getNodePorts;
    const getNodeSizeRef = useRef(getNodeSize);
    getNodeSizeRef.current = getNodeSize;
    const renderCanvasPortRef = useRef(renderCanvasPort);
    renderCanvasPortRef.current = renderCanvasPort;

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || width <= 0 || height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const tw = Math.max(1, Math.floor(width * dpr));
        const th = Math.max(1, Math.floor(height * dpr));

        // Only resize if necessary
        if (canvas.width !== tw) canvas.width = tw;
        if (canvas.height !== th) canvas.height = th;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const selectedSet = new Set(selectedNodeIds);
        const highlightedSet = highlightedNodeIds ? new Set(highlightedNodeIds) : null;
        const renderCanvasNodeLatest = renderCanvasNodeRef.current;
        const getNodeShapeLatest = getNodeShapeRef.current;
        const getNodeRadiusLatest = getNodeRadiusRef.current;
        const getNodePortsLatest = getNodePortsRef.current;
        const getNodeSizeLatest = getNodeSizeRef.current;
        const renderCanvasPortLatest = renderCanvasPortRef.current;

        // Viewport culling: skip nodes that cannot overlap the visible rect.
        // Read `positions` directly so culling stays consistent with what's
        // drawn even mid-drag/mid-simulation.
        const view = getVisibleGraphRect(viewport, width, height);

        // Draw all unselected nodes (selected nodes are handled by the React overlay)
        for (const node of nodes) {
            if (selectedSet.has(node.id)) continue;

            const pos = positions[node.id];
            if (!pos) continue;

            const radius = getNodeRadiusLatest(node);

            // Ports sit on the getNodeSize box, which can extend past both the
            // radius and the default rectangle. Resolve them before culling so
            // a node whose centre is just off-screen doesn't pop its still-
            // visible ports in and out at the viewport edge. Only consumers
            // that declare ports pay for the lookup.
            const ports = getNodePortsLatest ? resolveNodePorts(node, getNodePortsLatest) : [];
            const size = ports.length > 0 ? resolveNodeSize(node, getNodeSizeLatest) : null;

            // Per-node margin: consumers can set any radius (or draw wider
            // shapes), so the bound has to follow the node, not a constant.
            const margin = Math.max(
                radius,
                RECT_W / 2,
                RECT_H / 2,
                size ? size.width / 2 : 0,
                size ? size.height / 2 : 0
            ) + CULL_PAD;
            if (
                pos.x < view.minX - margin || pos.x > view.maxX + margin ||
                pos.y < view.minY - margin || pos.y > view.maxY + margin
            ) continue;

            const x = pos.x * viewport.zoom + viewport.x;
            const y = pos.y * viewport.zoom + viewport.y;

            const shape = resolveNodeShape(node, getNodeShapeLatest);
            const isRectangle = shape === "rectangle";
            const scaledRadius = radius * viewport.zoom;

            // Keyboard focus / connect-armed rings, drawn first so they read
            // as an outline behind whatever the node itself paints.
            if (node.id === focusedNodeId || node.id === connectFromId) {
                const isConnectSource = node.id === connectFromId;
                ctx.beginPath();
                if (isRectangle) {
                    const ringW = (RECT_W + 16) * viewport.zoom;
                    const ringH = (RECT_H + 16) * viewport.zoom;
                    drawRoundRect(ctx, x - ringW / 2, y - ringH / 2, ringW, ringH, (RECT_RADIUS + 6) * viewport.zoom);
                } else {
                    ctx.arc(x, y, scaledRadius + 7 * viewport.zoom, 0, 2 * Math.PI);
                }
                ctx.lineWidth = 2 * viewport.zoom;
                ctx.strokeStyle = isConnectSource ? "#22d3ee" : "#f8fafc";
                ctx.stroke();
            }

            // Cross-graph / external highlight ring, drawn first so it shows as
            // an outline behind either a custom-rendered or default-drawn node.
            if (highlightedSet && highlightedSet.has(node.id)) {
                ctx.beginPath();
                if (isRectangle) {
                    const ringW = (RECT_W + 12) * viewport.zoom;
                    const ringH = (RECT_H + 12) * viewport.zoom;
                    drawRoundRect(ctx, x - ringW / 2, y - ringH / 2, ringW, ringH, (RECT_RADIUS + 4) * viewport.zoom);
                } else {
                    ctx.arc(x, y, scaledRadius + 5 * viewport.zoom, 0, 2 * Math.PI);
                }
                ctx.lineWidth = 3 * viewport.zoom;
                ctx.strokeStyle = "#f59e0b"; // amber-500 — cross-graph highlight
                ctx.stroke();
            }

            // Allow the consumer to take over the node's *body*. Ports are
            // still drawn below: they are hit-tested through the spatial index,
            // so skipping the port pass here would leave a custom-rendered node
            // with invisible-but-live snap targets — a drag would land on a port
            // nothing ever painted.
            const handled = renderCanvasNodeLatest
                ? renderCanvasNodeLatest({ ctx, node, x, y, radius, zoom: viewport.zoom })
                : false;

            if (!handled) {
                ctx.beginPath();

                if (isRectangle) {
                    const rectWidth = RECT_W * viewport.zoom;
                    const rectHeight = RECT_H * viewport.zoom;
                    const rectRx = RECT_RADIUS * viewport.zoom;
                    drawRoundRect(ctx, x - rectWidth / 2, y - rectHeight / 2, rectWidth, rectHeight, rectRx);
                } else {
                    ctx.arc(x, y, scaledRadius, 0, 2 * Math.PI);
                }

                ctx.fillStyle = "#1e293b";   // bg-slate-800
                ctx.fill();

                ctx.lineWidth = 2 * viewport.zoom;
                ctx.strokeStyle = "#475569"; // border-slate-600
                ctx.stroke();

                // Draw basic label so it isn't literally just an empty circle
                const label = String(getDataString(node.data, "label") ?? node.id);
                if (label) {
                    ctx.fillStyle = "#e2e8f0"; // text-slate-200
                    ctx.font = `${12 * viewport.zoom}px sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    const maxWidth = isRectangle ? 140 * viewport.zoom : scaledRadius * 1.8;
                    if (maxWidth > 0) {
                        const metrics = ctx.measureText(label);
                        if (metrics.width > maxWidth) {
                            // Binary search for the longest prefix that fits within maxWidth.
                            let lo = 1, hi = label.length - 1;
                            while (lo < hi) {
                                const mid = (lo + hi + 1) >> 1;
                                if (ctx.measureText(label.slice(0, mid) + "...").width <= maxWidth) lo = mid;
                                else hi = mid - 1;
                            }
                            ctx.fillText(label.slice(0, lo) + "...", x, y, maxWidth);
                        } else {
                            ctx.fillText(label, x, y, maxWidth);
                        }
                    }
                }
            }

            // ── Ports ──────────────────────────────────────────────────────
            // Drawing ports here is what keeps canvas-rendered nodes
            // connectable: the drag hook hit-tests the spatial index, not the
            // DOM, so a port only needs to be *visible* here, not an element.
            // (`ports`/`size` were resolved above so the cull margin covers them.)
            if (ports.length === 0 || !size) continue;

            const portPositions = getPortPositions(pos, size, ports);

            for (const port of ports) {
                const p = portPositions.get(port.id);
                if (!p) continue;
                const px = p.x * viewport.zoom + viewport.x;
                const py = p.y * viewport.zoom + viewport.y;

                if (renderCanvasPortLatest) {
                    const portHandled = renderCanvasPortLatest({
                        ctx, node, port, side: getPortSide(port),
                        x: px, y: py, zoom: viewport.zoom,
                    });
                    if (portHandled) continue;
                }

                // Match the HTML layer: bar for main input, circle for main output, diamond otherwise.
                const half = PORT_SIZE * viewport.zoom / 2;
                const glyph = getPortGlyph(port);
                ctx.beginPath();
                if (glyph === "bar") {
                    const bw = PORT_BAR_WIDTH * viewport.zoom;
                    const bh = PORT_BAR_HEIGHT * viewport.zoom;
                    drawRoundRect(ctx, px - bw / 2, py - bh / 2, bw, bh, 2 * viewport.zoom);
                } else if (glyph === "circle") {
                    ctx.arc(px, py, half, 0, 2 * Math.PI);
                } else {
                    ctx.moveTo(px, py - half);
                    ctx.lineTo(px + half, py);
                    ctx.lineTo(px, py + half);
                    ctx.lineTo(px - half, py);
                    ctx.closePath();
                }
                ctx.fillStyle = "#1e293b";
                ctx.fill();
                ctx.lineWidth = Math.max(1, 1.5 * viewport.zoom);
                ctx.strokeStyle = "#94a3b8";
                ctx.stroke();
            }
        }
    }, [
        nodes,
        positions,
        viewport,
        width,
        height,
        selectedNodeIds,
        highlightedNodeIds,
        focusedNodeId,
        connectFromId,
        getNodeRadius,
        getNodeShape,
        renderCanvasNode,
        // The refs above keep the *values* current within a paint, but only a
        // dep can trigger the repaint — without these, changing any port
        // config left the last frame's ports on screen.
        getNodePorts,
        getNodeSize,
        renderCanvasPort,
    ]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none", // Let the canvas container handle all pointer events
                zIndex: 1 // Needs to be above edges, but below the React overlay
            }}
            aria-hidden
        />
    );
}) as <T>(props: NodeCanvasLayerProps<T>) => React.ReactElement | null;
