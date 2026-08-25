/**
 * Shared Canvas 2D node renderers for demos.
 *
 * Each function matches the visual style of its HTML counterpart in
 * node-renderers.tsx so unselected nodes drawn on the Canvas layer look
 * identical to the React-rendered selected nodes.
 */

import type { RenderCanvasNodeProps } from "@/graph-canvas";
import type {
  CircleNodeData,
  MixedNodeData,
  EditorNodeData,
} from "./data";
import {
  CIRCLE_RADIUS,
  ROUNDED_RECT_WIDTH,
  ROUNDED_RECT_HEIGHT,
  ROUNDED_RECT_CORNER_RADIUS,
} from "./data";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
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

function drawCircleNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  bgColor: string,
  borderColor: string,
  label: string,
  subtitle?: string,
) {
  const r = CIRCLE_RADIUS * zoom;

  // ── Background
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = 3 * zoom;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  // ── Subtitle (role / caption) — small uppercase text above centre
  if (subtitle) {
    const subFontSize = 11 * zoom;
    ctx.font = `500 ${subFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(226, 232, 240, 0.75)"; // #e2e8f0 at 75% opacity
    ctx.fillText(subtitle.toUpperCase(), x, y - r * 0.22);
  }

  // ── Label — main text at or just below centre
  const labelFontSize = 22 * zoom;
  ctx.font = `500 ${labelFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e2e8f0";
  const maxWidth = r * 1.6;
  const metrics = ctx.measureText(label);
  if (metrics.width > maxWidth) {
    ctx.fillText(label.slice(0, 6) + "…", x, y + (subtitle ? r * 0.22 : 0), maxWidth);
  } else {
    ctx.fillText(label, x, y + (subtitle ? r * 0.22 : 0));
  }
}

function drawRectangleNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
  gradStart: string,
  gradEnd: string,
  borderColor: string,
  label: string,
  badge?: string,
) {
  const w = ROUNDED_RECT_WIDTH * zoom;
  const h = ROUNDED_RECT_HEIGHT * zoom;
  const rx = ROUNDED_RECT_CORNER_RADIUS * zoom;
  const left = x - w / 2;
  const top = y - h / 2;

  // ── Background gradient (160° ≈ top-right → bottom-left)
  const grad = ctx.createLinearGradient(left + w * 0.8, top, left + w * 0.2, top + h);
  grad.addColorStop(0, gradStart);
  grad.addColorStop(1, gradEnd);
  drawRoundRect(ctx, left, top, w, h, rx);
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Border
  ctx.lineWidth = 3 * zoom;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  // ── Badge pill
  if (badge) {
    const badgeFontSize = 10 * zoom;
    ctx.font = `700 ${badgeFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const badgeText = badge.toUpperCase();
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
    ctx.fillText(badgeText, x, pillY + pillH / 2);
  }

  // ── Label
  const labelFontSize = 24 * zoom;
  ctx.font = `500 ${labelFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ecfeff";
  ctx.fillText(label, x, y + h * 0.12);
}

// ─── Public renderers ────────────────────────────────────────────────────────

/**
 * Circle node (blue-ish unselected style matching CircleNode in node-renderers.tsx).
 * Used by: circle-render, context-menus, dashed-edges, edge-renderer, edge-routes,
 *          on-edge-create, preview-phase
 */
export function renderCircleCanvasNode({
  ctx,
  node,
  x,
  y,
  zoom,
}: RenderCanvasNodeProps<CircleNodeData>): boolean {
  drawCircleNode(
    ctx, x, y, zoom,
    "#1e293b",  // bg-slate-800
    "#475569",  // border-slate-600
    node.data.label,
    node.data.role,
  );
  return true;
}

/**
 * Mixed shape node: circle → blue gradient; rectangle → teal gradient.
 * Used by: mixed-shape-rules
 */
export function renderMixedCanvasNode({
  ctx,
  node,
  x,
  y,
  zoom,
}: RenderCanvasNodeProps<MixedNodeData>): boolean {
  if (node.data.shape === "circle") {
    const data = node.data as Extract<MixedNodeData, { shape: "circle" }>;
    // Blue gradient circle (unselected style from MixedShapeNode)
    const r = CIRCLE_RADIUS * zoom;
    const grad = ctx.createLinearGradient(
      x + r * 0.6, y - r,
      x - r * 0.6, y + r,
    );
    grad.addColorStop(0, "#1e3a8a"); // blue-900
    grad.addColorStop(1, "#0f172a"); // slate-900
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3 * zoom;
    ctx.strokeStyle = "#64748b"; // slate-500
    ctx.stroke();

    // Subtitle
    const subFontSize = 11 * zoom;
    ctx.font = `500 ${subFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(226, 232, 240, 0.78)";
    ctx.fillText(data.role.toUpperCase(), x, y - r * 0.22);

    // Label
    const labelFontSize = 24 * zoom;
    ctx.font = `500 ${labelFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(data.label, x, y + r * 0.22);
  } else {
    const data = node.data as Extract<MixedNodeData, { shape: "rectangle" }>;
    drawRectangleNode(
      ctx, x, y, zoom,
      "#164e63", "#0f172a", // teal gradient
      "#475569",           // slate-600 border
      data.label,
      data.status,
    );
  }
  return true;
}

/**
 * Editor node: circle → blue gradient; rectangle → teal gradient.
 * Used by: graph-editor
 */
export function renderEditorCanvasNode({
  ctx,
  node,
  x,
  y,
  zoom,
}: RenderCanvasNodeProps<EditorNodeData>): boolean {
  if (node.data.shape === "circle") {
    // Blue gradient circle (matches EditorNode circle branch)
    const r = CIRCLE_RADIUS * zoom;
    const grad = ctx.createLinearGradient(
      x + r * 0.6, y - r,
      x - r * 0.6, y + r,
    );
    grad.addColorStop(0, "#1e3a8a");
    grad.addColorStop(1, "#0f172a");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3 * zoom;
    ctx.strokeStyle = "#64748b";
    ctx.stroke();

    // Caption (subtitle)
    const subFontSize = 11 * zoom;
    ctx.font = `500 ${subFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(226, 232, 240, 0.78)";
    ctx.fillText(node.data.caption.toUpperCase(), x, y - r * 0.22);

    // Label
    const labelFontSize = 24 * zoom;
    ctx.font = `500 ${labelFontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(node.data.label, x, y + r * 0.22);
  } else {
    drawRectangleNode(
      ctx, x, y, zoom,
      "#164e63", "#0f172a", // teal gradient
      "#475569",           // slate-600 border
      node.data.label,
      node.data.caption,
    );
  }
  return true;
}
