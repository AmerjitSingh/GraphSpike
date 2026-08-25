"use client";

import { memo, useCallback, useId, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { GraphNode, NodePosition, Viewport } from "../types.js";
import { DEFAULT_NODE_RADIUS, getVisibleGraphRect, type GraphRect } from "../geometry.js";

interface MiniMapProps<T> {
  nodes: GraphNode<T>[];
  positions: Record<string, NodePosition>;
  viewport: Viewport;
  /** Main canvas pixel dimensions (for mapping the visible rectangle). */
  containerWidth: number;
  containerHeight: number;
  /** Recenter the main view on a graph-space point (called live while dragging). */
  onNavigate: (graphX: number, graphY: number) => void;
  /** Minimap panel size in pixels. */
  width?: number;
  height?: number;
  /** Extra positioning/appearance overrides for the panel. */
  style?: CSSProperties;
}

const INSET = 6; // px between the panel edge and the drawn content

export interface MiniMapGeometry {
  /** Graph-space origin of the fitted region. */
  boundsMinX: number;
  boundsMinY: number;
  /** Graph units → minimap px. */
  scale: number;
  /** Minimap-space offset of the fitted region. */
  offsetX: number;
  offsetY: number;
}

/**
 * Map graph space → minimap space. The fitted region is the node extent UNIONED
 * with the currently visible rect, so the viewport indicator is always inside
 * the panel: panning far away from the graph shrinks the dots instead of
 * silently clipping the indicator out of existence. Scale is capped at 1 so a
 * tiny cluster isn't magnified past life size.
 *
 * Exported for unit testing; returns null when there is nothing to fit.
 */
export function computeMiniMapGeometry(
  nodeBounds: GraphRect | null,
  viewport: Viewport,
  containerWidth: number,
  containerHeight: number,
  width: number,
  height: number
): MiniMapGeometry | null {
  if (!nodeBounds || !(viewport.zoom > 0)) return null;

  const vis = getVisibleGraphRect(viewport, containerWidth, containerHeight);
  const minX = Math.min(nodeBounds.minX, vis.minX);
  const minY = Math.min(nodeBounds.minY, vis.minY);
  const maxX = Math.max(nodeBounds.maxX, vis.maxX);
  const maxY = Math.max(nodeBounds.maxY, vis.maxY);

  const graphW = Math.max(1, maxX - minX);
  const graphH = Math.max(1, maxY - minY);
  const pad = Math.max(graphW, graphH) * 0.08 + 20;
  const boundsW = graphW + pad * 2;
  const boundsH = graphH + pad * 2;

  const innerW = Math.max(1, width - INSET * 2);
  const innerH = Math.max(1, height - INSET * 2);
  const scale = Math.min(1, innerW / boundsW, innerH / boundsH);

  return {
    boundsMinX: minX - pad,
    boundsMinY: minY - pad,
    scale,
    offsetX: INSET + (innerW - boundsW * scale) / 2,
    offsetY: INSET + (innerH - boundsH * scale) / 2,
  };
}

/**
 * A compact navigator: a scaled mini-view of the whole graph with the current
 * viewport drawn as a rectangle. Click or drag inside it to pan the main view.
 */
function MiniMapInner<T>({
  nodes,
  positions,
  viewport,
  containerWidth,
  containerHeight,
  onNavigate,
  width = 190,
  height = 130,
  style,
}: MiniMapProps<T>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const clipId = useId();

  // Node extent only — the O(n) scan, kept off the pan/zoom path.
  const nodeBounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const p = positions[node.id];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }, [nodes, positions]);

  const geometry = useMemo(
    () =>
      computeMiniMapGeometry(nodeBounds, viewport, containerWidth, containerHeight, width, height),
    [nodeBounds, viewport, containerWidth, containerHeight, width, height]
  );

  const toMini = useCallback(
    (gx: number, gy: number) => {
      if (!geometry) return { x: 0, y: 0 };
      return {
        x: (gx - geometry.boundsMinX) * geometry.scale + geometry.offsetX,
        y: (gy - geometry.boundsMinY) * geometry.scale + geometry.offsetY,
      };
    },
    [geometry]
  );

  // Current visible graph rectangle → minimap rectangle.
  const viewRect = useMemo(() => {
    if (!geometry || !(viewport.zoom > 0)) return null;
    const visMinX = -viewport.x / viewport.zoom;
    const visMinY = -viewport.y / viewport.zoom;
    const tl = toMini(visMinX, visMinY);
    return {
      x: tl.x,
      y: tl.y,
      w: (containerWidth / viewport.zoom) * geometry.scale,
      h: (containerHeight / viewport.zoom) * geometry.scale,
    };
  }, [geometry, viewport, containerWidth, containerHeight, toMini]);

  // The drawn geometry follows the viewport (so the indicator stays in frame),
  // but navigation must NOT: mapping a pointer through geometry that the last
  // navigation just changed makes each drag update move the target, and the
  // viewport accelerates away from the cursor. Freeze the mapping for the whole
  // gesture, so a given pixel means the same graph point from press to release.
  const dragGeometryRef = useRef<MiniMapGeometry | null>(null);

  const navigateToPointer = useCallback(
    (clientX: number, clientY: number, geom: MiniMapGeometry | null) => {
      const svg = svgRef.current;
      if (!svg || !geom) return;
      const rect = svg.getBoundingClientRect();
      const gx = (clientX - rect.left - geom.offsetX) / geom.scale + geom.boundsMinX;
      const gy = (clientY - rect.top - geom.offsetY) / geom.scale + geom.boundsMinY;
      onNavigate(gx, gy);
    },
    [onNavigate]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      draggingRef.current = true;
      dragGeometryRef.current = geometry;
      svgRef.current?.setPointerCapture(e.pointerId);
      navigateToPointer(e.clientX, e.clientY, geometry);
    },
    [geometry, navigateToPointer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!draggingRef.current) return;
      navigateToPointer(e.clientX, e.clientY, dragGeometryRef.current);
    },
    [navigateToPointer]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragGeometryRef.current = null;
    // Only release what we actually hold: on pointercancel the UA has already
    // released capture and dropped the pointer, and releasing again throws.
    const svg = svgRef.current;
    if (svg?.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }, []);

  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  // Loosely reflect node size in the dots, clamped small.
  const dotRadius = geometry
    ? Math.min(2.2, Math.max(1, DEFAULT_NODE_RADIUS * geometry.scale))
    : 1;

  return (
    <div
      data-gc-minimap
      // A redundant pointer-only affordance: everything it does (moving the
      // viewport) is reachable from the keyboard through the graph's own
      // bindings, so it is hidden from assistive tech rather than exposed as
      // an un-operable control.
      aria-hidden
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        width,
        height,
        zIndex: 15,
        borderRadius: 10,
        overflow: "hidden",
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(148, 163, 184, 0.22)",
        boxShadow: "0 8px 24px rgba(2, 6, 23, 0.45)",
        backdropFilter: "blur(6px)",
        ...style,
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "block", cursor: "pointer", touchAction: "none" }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={INSET} y={INSET} width={width - INSET * 2} height={height - INSET * 2} rx={6} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {geometry &&
            nodes.map((node) => {
              const p = positions[node.id];
              if (!p) return null;
              const m = toMini(p.x, p.y);
              return <circle key={node.id} cx={m.x} cy={m.y} r={dotRadius} fill="rgba(148, 163, 184, 0.65)" />;
            })}

          {viewRect && (
            <rect
              x={viewRect.x}
              y={viewRect.y}
              width={Math.max(2, viewRect.w)}
              height={Math.max(2, viewRect.h)}
              fill="rgba(96, 165, 250, 0.14)"
              stroke="#60a5fa"
              strokeWidth={1.5}
              rx={2}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}

export const MiniMap = memo(MiniMapInner) as <T>(props: MiniMapProps<T>) => React.ReactElement | null;
export type { MiniMapProps };
