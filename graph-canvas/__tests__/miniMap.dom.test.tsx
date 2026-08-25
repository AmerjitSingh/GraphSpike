// @vitest-environment jsdom
import "./setup.dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { MiniMap, computeMiniMapGeometry } from "../renderers/MiniMap";
import type { GraphNode, NodePosition, Viewport } from "../types";

afterEach(() => cleanup());

type Data = { label: string };

const nodes: GraphNode<Data>[] = [
  { id: "a", data: { label: "A" } },
  { id: "b", data: { label: "B" } },
  { id: "c", data: { label: "C" } },
];
const positions: Record<string, NodePosition> = {
  a: { x: -200, y: -100 },
  b: { x: 200, y: 100 },
  c: { x: 0, y: 0 },
};

const PANEL = { width: 190, height: 130 };
const CONTAINER = { width: 800, height: 600 };
const identity: Viewport = { x: 0, y: 0, zoom: 1 };

function renderMiniMap(over: Partial<Parameters<typeof MiniMap<Data>>[0]> = {}) {
  const onNavigate = vi.fn<(x: number, y: number) => void>();
  const props = {
    nodes,
    positions,
    viewport: identity,
    containerWidth: CONTAINER.width,
    containerHeight: CONTAINER.height,
    onNavigate,
    ...PANEL,
    ...over,
  };
  const utils = render(<MiniMap<Data> {...props} />);
  return { ...utils, onNavigate, props };
}

/** The graph point the component should derive for a given client point. */
function expectedGraphPoint(viewport: Viewport, clientX: number, clientY: number) {
  const bounds = { minX: -200, minY: -100, maxX: 200, maxY: 100 };
  const g = computeMiniMapGeometry(
    bounds, viewport, CONTAINER.width, CONTAINER.height, PANEL.width, PANEL.height
  )!;
  // setup.dom gives every element a rect at (0,0), so client === svg-local.
  return {
    x: (clientX - g.offsetX) / g.scale + g.boundsMinX,
    y: (clientY - g.offsetY) / g.scale + g.boundsMinY,
  };
}

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, ...init,
  });
}

describe("MiniMap — rendering", () => {
  it("marks itself as chrome and hides itself from assistive tech", () => {
    // Both are load-bearing: the zoom filter and the container's hover/click
    // handlers key off [data-gc-minimap], and the minimap duplicates navigation
    // that keyboard users reach through the graph's own bindings.
    const { container } = renderMiniMap();
    const panel = container.querySelector("[data-gc-minimap]")!;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws one dot per positioned node", () => {
    const { container } = renderMiniMap();
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });

  it("skips nodes that have no position", () => {
    const { container } = renderMiniMap({ positions: { a: positions.a } });
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders no dots and no viewport rect when nothing is positioned", () => {
    const { container } = renderMiniMap({ positions: {} });
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.querySelector('rect[stroke="#60a5fa"]')).toBeNull();
  });

  it("draws the viewport indicator", () => {
    const { container } = renderMiniMap();
    const rect = container.querySelector('rect[stroke="#60a5fa"]')!;
    expect(rect).toBeTruthy();
    expect(rect.getAttribute("pointer-events")).toBe("none");
  });

  it("floors the indicator at 2px so it never vanishes when zoomed far in", () => {
    const { container } = renderMiniMap({ viewport: { x: 0, y: 0, zoom: 500 } });
    const rect = container.querySelector('rect[stroke="#60a5fa"]')!;
    expect(Number(rect.getAttribute("width"))).toBeGreaterThanOrEqual(2);
    expect(Number(rect.getAttribute("height"))).toBeGreaterThanOrEqual(2);
  });
});

describe("MiniMap — navigation", () => {
  it("navigates to the pressed point", () => {
    const { container, onNavigate } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 40 }));
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const want = expectedGraphPoint(identity, 60, 40);
    expect(onNavigate.mock.calls[0][0]).toBeCloseTo(want.x);
    expect(onNavigate.mock.calls[0][1]).toBeCloseTo(want.y);
  });

  it("ignores non-primary buttons", () => {
    const { container, onNavigate } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { button: 2, clientX: 60, clientY: 40 }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("ignores moves that are not part of a drag", () => {
    const { container, onNavigate } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    act(() => {
      svg.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 40 }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps navigating while dragging", () => {
    const { container, onNavigate } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 40 }));
      svg.dispatchEvent(pointer("pointermove", { clientX: 80, clientY: 50 }));
    });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("stops navigating after release", () => {
    const { container, onNavigate } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 40 }));
      svg.dispatchEvent(pointer("pointerup", { clientX: 60, clientY: 40 }));
      svg.dispatchEvent(pointer("pointermove", { clientX: 90, clientY: 60 }));
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("freezes the pointer->graph mapping for the whole gesture", () => {
    // Regression: the drawn geometry follows the viewport (so the indicator
    // stays in frame). If navigation also used the live geometry, each update
    // would move the next event's target and the view would accelerate away
    // from the cursor. The mapping must be snapshotted at pointerdown.
    const { container, onNavigate, rerender, props } = renderMiniMap();
    const svg = container.querySelector("svg")!;

    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 40 }));
    });
    const first = onNavigate.mock.calls[0];

    // The navigation moved the viewport a long way, which changes the geometry.
    const movedViewport: Viewport = { x: -900, y: -400, zoom: 1 };
    rerender(<MiniMap<Data> {...props} viewport={movedViewport} />);

    act(() => {
      svg.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 40 }));
    });
    const second = onNavigate.mock.calls[1];

    // Same pixel, same gesture => same graph point, despite the new viewport.
    expect(second[0]).toBeCloseTo(first[0]);
    expect(second[1]).toBeCloseTo(first[1]);

    // Sanity: the live geometry really did change, so this isn't vacuous.
    const live = expectedGraphPoint(movedViewport, 60, 40);
    expect(live.x).not.toBeCloseTo(first[0]);
  });

  it("survives pointercancel without throwing", () => {
    // hasPointerCapture is stubbed false, so releasePointerCapture must be
    // skipped rather than throwing NotFoundError out of the handler.
    const { container } = renderMiniMap();
    const svg = container.querySelector("svg")!;
    expect(() =>
      act(() => {
        svg.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 40 }));
        svg.dispatchEvent(pointer("pointercancel", { clientX: 60, clientY: 40 }));
      })
    ).not.toThrow();
  });
});

describe("MiniMap — event containment", () => {
  it("does not let clicks reach the graph beneath it", () => {
    const onParentClick = vi.fn<() => void>();
    const onParentContextMenu = vi.fn<() => void>();
    const { container } = render(
      <div onClick={onParentClick} onContextMenu={onParentContextMenu}>
        <MiniMap<Data>
          nodes={nodes}
          positions={positions}
          viewport={identity}
          containerWidth={CONTAINER.width}
          containerHeight={CONTAINER.height}
          onNavigate={() => {}}
        />
      </div>
    );
    const panel = container.querySelector("[data-gc-minimap]")!;
    act(() => {
      panel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentContextMenu).not.toHaveBeenCalled();
  });
});
