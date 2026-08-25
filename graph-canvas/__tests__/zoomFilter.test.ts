import { describe, it, expect } from "vitest";
import { getZoomEventClientPoint, shouldZoomGestureStart } from "../hooks/useCanvasZoom";
import { resolvePrimaryGestureOwner } from "../interaction";
import type { ZoomFilterEvent } from "../hooks/useCanvasZoom";

/** A fake event target that "matches" the given ancestor selectors. */
function target(...matches: string[]): ZoomFilterEvent["target"] {
  return {
    closest: (selector: string) =>
      matches.some((m) => selector.includes(m)) ? {} : null,
  };
}

const bare = target();
const onMinimap = target("[data-gc-minimap]");
const onMenu = target("[data-gc-context-menu]");
const onNode = target("[data-gc-node]");
const onDragHandle = target("[data-gc-drag-handle]");

const evt = (over: Partial<ZoomFilterEvent> = {}): ZoomFilterEvent => ({
  type: "pointerdown",
  button: 0,
  target: bare,
  ...over,
});

const DEFAULTS = { spacePressed: false, panOnDrag: false };

describe("shouldZoomGestureStart — chrome overlays", () => {
  it("blocks a gesture starting on the minimap, even with space held", () => {
    // Regression: the minimap navigates by absolute recenter, so letting d3
    // also pan made the two transforms fight every frame.
    expect(
      shouldZoomGestureStart(evt({ target: onMinimap }), { ...DEFAULTS, spacePressed: true })
    ).toBe(false);
  });

  it("blocks a minimap gesture in panOnDrag mode (plain left-drag)", () => {
    expect(
      shouldZoomGestureStart(evt({ target: onMinimap }), { ...DEFAULTS, panOnDrag: true })
    ).toBe(false);
  });

  it("blocks wheel-zoom over the minimap", () => {
    expect(
      shouldZoomGestureStart(evt({ type: "wheel", target: onMinimap }), DEFAULTS)
    ).toBe(false);
  });

  it("blocks touch gestures on the minimap (no button property)", () => {
    expect(
      shouldZoomGestureStart(
        { type: "touchstart", target: onMinimap } as ZoomFilterEvent,
        DEFAULTS
      )
    ).toBe(false);
  });

  it("blocks a gesture starting on the context menu", () => {
    expect(shouldZoomGestureStart(evt({ target: onMenu }), DEFAULTS)).toBe(false);
  });
});

describe("shouldZoomGestureStart — right button", () => {
  it("never pans on right-drag, so drift can't dismiss the context menu", () => {
    expect(shouldZoomGestureStart(evt({ button: 2 }), DEFAULTS)).toBe(false);
    expect(
      shouldZoomGestureStart(evt({ button: 2 }), { ...DEFAULTS, spacePressed: true })
    ).toBe(false);
    expect(
      shouldZoomGestureStart(evt({ button: 2 }), { ...DEFAULTS, panOnDrag: true })
    ).toBe(false);
  });
});

describe("shouldZoomGestureStart — normal paths still work", () => {
  it("allows wheel zoom on the canvas", () => {
    expect(shouldZoomGestureStart(evt({ type: "wheel" }), DEFAULTS)).toBe(true);
  });

  it("allows space-drag panning on the canvas", () => {
    expect(
      shouldZoomGestureStart(evt(), { ...DEFAULTS, spacePressed: true })
    ).toBe(true);
  });

  it("allows middle-mouse drag", () => {
    expect(shouldZoomGestureStart(evt({ button: 1 }), DEFAULTS)).toBe(true);
  });

  it("blocks plain left-drag (nodes own it) unless panOnDrag", () => {
    expect(shouldZoomGestureStart(evt({ button: 0 }), DEFAULTS)).toBe(false);
    expect(
      shouldZoomGestureStart(evt({ button: 0 }), { ...DEFAULTS, panOnDrag: true })
    ).toBe(true);
  });

  it("keeps overlay drag handles working in panOnDrag mode", () => {
    expect(
      shouldZoomGestureStart(evt({ button: 0, target: onDragHandle }), {
        ...DEFAULTS,
        panOnDrag: true,
      })
    ).toBe(false);
  });

  it("blocks a non-left drag starting inside a node", () => {
    expect(shouldZoomGestureStart(evt({ button: 3, target: onNode }), DEFAULTS)).toBe(false);
  });
});

describe("shouldZoomGestureStart — marquee owns left-drag", () => {
  const blank = { type: "pointerdown", button: 0, target: null };

  it("yields left-drag to the marquee when both are enabled", () => {
    // Both claiming the gesture doesn't just double up: the marquee anchors in
    // container coordinates and resolves to graph space only on pointerup, so
    // panning underneath makes the committed selection drift from the drawn
    // rectangle.
    expect(
      shouldZoomGestureStart(blank, { spacePressed: false, panOnDrag: true, marqueeSelect: true })
    ).toBe(false);
  });

  it("still pans on left-drag when the marquee is off", () => {
    expect(
      shouldZoomGestureStart(blank, { spacePressed: false, panOnDrag: true, marqueeSelect: false })
    ).toBe(true);
  });

  it("keeps space-drag panning even with the marquee on", () => {
    // The fallback that makes "marquee wins" cost nothing.
    expect(
      shouldZoomGestureStart(blank, { spacePressed: true, panOnDrag: true, marqueeSelect: true })
    ).toBe(true);
  });

  it("keeps middle-drag panning even with the marquee on", () => {
    expect(
      shouldZoomGestureStart(
        { type: "pointerdown", button: 1, target: null },
        { spacePressed: false, panOnDrag: true, marqueeSelect: true }
      )
    ).toBe(true);
  });

  it("still pans a drag that starts on a node", () => {
    // Regression: yielding *all* left-drag left promoted DOM nodes with no
    // gesture at all — zoom yielded, node dragging was off under panOnDrag,
    // and the marquee rejects nodes.
    const overNode = {
      type: "pointerdown",
      button: 0,
      target: { closest: (sel: string) => (sel.includes("data-gc-node") ? {} : null) },
    };
    expect(
      shouldZoomGestureStart(overNode, { spacePressed: false, panOnDrag: true, marqueeSelect: true })
    ).toBe(true);
  });

  it("treats a touch drag as a primary press", () => {
    // Touch events carry no `button`, so every `button === 0` test missed and
    // a single touch could start a pan and a marquee together.
    const touch = { type: "touchstart", target: null };
    expect(
      shouldZoomGestureStart(touch, { spacePressed: false, panOnDrag: true, marqueeSelect: true })
    ).toBe(false);
  });

  it("blocks a plain touch drag so nodes and marquee keep it", () => {
    const touch = { type: "touchstart", target: null };
    expect(
      shouldZoomGestureStart(touch, { spacePressed: false, panOnDrag: false })
    ).toBe(false);
  });

  it("allows a pinch: d3 owns multi-touch", () => {
    // Regression: classifying every touchstart as a primary press rejected
    // both contacts of a two-finger gesture, disabling pinch zoom by default.
    const pinch = {
      type: "touchstart",
      touches: {
        0: { clientX: 10, clientY: 20 },
        1: { clientX: 30, clientY: 40 },
        length: 2,
      },
      target: null,
    };
    expect(shouldZoomGestureStart(pinch, { spacePressed: false, panOnDrag: false })).toBe(true);
    expect(
      shouldZoomGestureStart(pinch, { spacePressed: false, panOnDrag: true, marqueeSelect: true })
    ).toBe(true);
  });

  it("rejects a pinch when any active touch began on an interactive control", () => {
    const control = target("button") as EventTarget;
    const pinch = {
      type: "touchstart",
      touches: {
        0: { clientX: 10, clientY: 20, target: control },
        1: { clientX: 30, clientY: 40, target: bare as EventTarget },
        length: 2,
      },
      // The newest contact dispatched from blank canvas; looking only here
      // would incorrectly let d3 consume the control-owned first contact too.
      target: bare,
    };
    expect(shouldZoomGestureStart(pinch, DEFAULTS)).toBe(false);
  });

  it("rejects a pinch when any active touch began on canvas chrome", () => {
    const pinch = {
      type: "touchstart",
      touches: {
        0: { clientX: 10, clientY: 20, target: onMinimap as EventTarget },
        1: { clientX: 30, clientY: 40, target: bare as EventTarget },
        length: 2,
      },
      target: bare,
    };
    expect(shouldZoomGestureStart(pinch, DEFAULTS)).toBe(false);
  });

  it("rejects a pinch when any active touch began on a consumer drag handle", () => {
    const pinch = {
      type: "touchstart",
      touches: {
        0: { clientX: 10, clientY: 20, target: onDragHandle as EventTarget },
        1: { clientX: 30, clientY: 40, target: bare as EventTarget },
        length: 2,
      },
      target: bare,
    };
    expect(shouldZoomGestureStart(pinch, DEFAULTS)).toBe(false);
  });

  it("reads a single touch's real client coordinates for canvas hit-testing", () => {
    const seen: number[] = [];
    const touch = {
      type: "touchstart",
      touches: { 0: { clientX: 73, clientY: 91 }, length: 1 },
      target: null,
    };
    expect(getZoomEventClientPoint(touch)).toEqual({ x: 73, y: 91 });
    expect(
      shouldZoomGestureStart(touch, {
        spacePressed: false,
        panOnDrag: true,
        marqueeSelect: true,
        isPointOnNode: (x, y) => {
          seen.push(x, y);
          return true;
        },
      })
    ).toBe(true);
    expect(seen).toEqual([73, 91]);
  });

  it("treats a canvas-only node as a node, not blank canvas", () => {
    // Canvas nodes have no DOM, so a selector test alone would call this blank
    // space and give the same drag a different owner once selection promoted
    // the node into the DOM layer.
    const overCanvasNode = { type: "pointerdown", button: 0, target: null, clientX: 10, clientY: 10 };
    expect(
      shouldZoomGestureStart(overCanvasNode, {
        spacePressed: false, panOnDrag: true, marqueeSelect: true,
        isPointOnNode: () => true,
      })
    ).toBe(true);
    expect(
      shouldZoomGestureStart(overCanvasNode, {
        spacePressed: false, panOnDrag: true, marqueeSelect: true,
        isPointOnNode: () => false,
      })
    ).toBe(false);
  });

  it("lets a port connect normally, but Space override it with pan", () => {
    // NodeLayer declines connection while Space is active, so D3 must accept
    // the port press or the documented Space-pan gesture has no owner.
    const onPort = {
      type: "pointerdown",
      button: 0,
      target: { closest: (sel: string) => (sel.includes("data-gc-handle") ? {} : null) },
    };
    expect(shouldZoomGestureStart(onPort, { spacePressed: false, panOnDrag: true })).toBe(false);
    expect(shouldZoomGestureStart(onPort, { spacePressed: true, panOnDrag: false })).toBe(true);
  });

  it("keeps wheel zoom working", () => {
    expect(
      shouldZoomGestureStart(
        { type: "wheel", button: 0, target: null },
        { spacePressed: false, panOnDrag: true, marqueeSelect: true }
      )
    ).toBe(true);
  });
});

describe("resolvePrimaryGestureOwner", () => {
  const base = {
    target: null,
    pointOnNode: false,
    spacePressed: false,
    panOnDrag: true,
    marqueeSelect: true,
  };

  it("gives a canvas node to pan and blank space to marquee", () => {
    expect(resolvePrimaryGestureOwner({ ...base, pointOnNode: true })).toBe("pan");
    expect(resolvePrimaryGestureOwner(base)).toBe("marquee");
  });

  it("gives Space precedence over a connector", () => {
    const port = target("[data-gc-handle]") as EventTarget;
    expect(resolvePrimaryGestureOwner({ ...base, target: port, spacePressed: false })).toBe("connect");
    expect(resolvePrimaryGestureOwner({ ...base, target: port, spacePressed: true })).toBe("pan");
  });

  it("never gives an ARIA control to the graph", () => {
    const control = target('[role="switch"]') as EventTarget;
    expect(resolvePrimaryGestureOwner({ ...base, target: control, spacePressed: true })).toBe("control");
  });

  it("never gives composite ARIA widget padding to the graph", () => {
    for (const role of ["menu", "menubar", "tree", "treegrid", "grid", "tablist", "radiogroup", "toolbar"]) {
      const control = target(`[role="${role}"]`) as EventTarget;
      expect(resolvePrimaryGestureOwner({ ...base, target: control })).toBe("control");
    }
  });
});
