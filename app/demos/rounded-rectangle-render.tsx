"use client";

import { useCallback } from "react";
import { GraphCanvas } from "@/graph-canvas";
import type { RenderCanvasNodeProps } from "@/graph-canvas";
import { GraphStage } from "./_shared/ui";
import { RoundedRectangleNode } from "./_shared/node-renderers";
import {
  roundedRectNodes,
  roundedRectEdges,
  ROUNDED_RECT_COLLISION_RADIUS,
  ROUNDED_RECT_WIDTH,
  ROUNDED_RECT_HEIGHT,
  ROUNDED_RECT_CORNER_RADIUS,
} from "./_shared/data";
import { getRoundedRectangleAnchor } from "./_shared/utils";
import type { RoundedRectNodeData, DemoEdgeData } from "./_shared/data";

/** Polyfill-safe rounded rectangle for canvas. */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    const cr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + cr, y);
    ctx.arcTo(x + w, y, x + w, y + h, cr);
    ctx.arcTo(x + w, y + h, x, y + h, cr);
    ctx.arcTo(x, y + h, x, y, cr);
    ctx.arcTo(x, y, x + w, y, cr);
    ctx.closePath();
  }
}

/**
 * Custom canvas renderer for unselected rounded-rectangle nodes.
 * Matches the teal gradient style of the HTML RoundedRectangleNode.
 */
function renderRoundedRectCanvasNode({
  ctx,
  node,
  x,
  y,
  zoom,
}: RenderCanvasNodeProps<RoundedRectNodeData>): boolean {
  const w = ROUNDED_RECT_WIDTH * zoom;
  const h = ROUNDED_RECT_HEIGHT * zoom;
  const rx = ROUNDED_RECT_CORNER_RADIUS * zoom;
  const left = x - w / 2;
  const top = y - h / 2;

  // ── Background gradient (160deg ≈ top-right → bottom-left)
  // For a 160° CSS gradient, the Canvas line runs roughly from (right-ish, top) to (left-ish, bottom).
  const grad = ctx.createLinearGradient(left + w * 0.8, top, left + w * 0.2, top + h);
  grad.addColorStop(0, "#164e63"); // cyan-900
  grad.addColorStop(1, "#0f172a"); // slate-900
  drawRoundRect(ctx, left, top, w, h, rx);
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Border
  ctx.lineWidth = 3 * zoom;
  ctx.strokeStyle = "#155e75"; // cyan-800
  ctx.stroke();

  // ── Status badge pill
  const status = node.data.status;
  if (status) {
    const badgeFontSize = 10 * zoom;
    ctx.font = `700 ${badgeFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const badgeText = status.toUpperCase();
    const badgeMetrics = ctx.measureText(badgeText);
    const pillPadX = 8 * zoom;
    const pillPadY = 4 * zoom;
    const pillW = badgeMetrics.width + pillPadX * 2;
    const pillH = badgeFontSize + pillPadY * 2;
    const pillX = x - pillW / 2;
    const pillY = y - h * 0.18 - pillH / 2;
    const pillR = Math.min(999 * zoom, pillH / 2);

    drawRoundRect(ctx, pillX, pillY, pillW, pillH, pillR);
    ctx.fillStyle = "rgba(236, 254, 255, 0.14)";
    ctx.fill();

    ctx.fillStyle = "#ecfeff";
    ctx.letterSpacing = `${0.12 * badgeFontSize}px`;
    ctx.fillText(badgeText, x, pillY + pillH / 2);
    ctx.letterSpacing = "0px";
  }

  // ── Label
  const label = node.data.label;
  if (label) {
    const labelFontSize = 24 * zoom;
    ctx.font = `500 ${labelFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ecfeff"; // cyan-50
    ctx.fillText(label, x, y + h * 0.12);
  }

  return true; // skip default drawing
}

export function RoundedRectangleRenderDemo() {
  const canvasNodeRenderer = useCallback(
    (props: RenderCanvasNodeProps<RoundedRectNodeData>) =>
      renderRoundedRectCanvasNode(props),
    []
  );

  return (
    <GraphStage>
      <GraphCanvas<RoundedRectNodeData, DemoEdgeData>
        nodes={roundedRectNodes}
        edges={roundedRectEdges}
        getNodeRadius={() => ROUNDED_RECT_COLLISION_RADIUS}
        getNodeShape={() => "rectangle"}
        getNodeAnchor={getRoundedRectangleAnchor}
        renderNode={RoundedRectangleNode}
        renderCanvasNode={canvasNodeRenderer}
        onConnect={(connection) => console.log("connect", connection)}
        onNodeDoubleClick={(id) => console.log("dbl click", id)}
      />
    </GraphStage>
  );
}
