// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, render, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useSpaceBarPan } from "../hooks/useSpaceBarPan";
import { useOverlayDrag } from "../hooks/useOverlayDrag";
import { useViewportSize } from "../hooks/useViewportSize";
import { GraphLinkProvider, useGraphLink, useGraphLinkState } from "../link/context";
import { createGraphLink } from "../link/GraphLink";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── useSpaceBarPan ───────────────────────────────────────────────────────────

function keydown(target: EventTarget, code = "Space") {
  const e = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}
function keyup(target: EventTarget, code = "Space") {
  target.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

describe("useSpaceBarPan", () => {
  it("tracks the space bar and prevents the page scrolling", () => {
    const hook = renderHook(() => useSpaceBarPan());
    let evt!: KeyboardEvent;
    act(() => { evt = keydown(window); });
    expect(hook.result.current.spacePressedRef.current).toBe(true);
    expect(hook.result.current.isSpacePressed).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    act(() => keyup(window));
    expect(hook.result.current.spacePressedRef.current).toBe(false);
    expect(hook.result.current.isSpacePressed).toBe(false);
  });

  it("ignores other keys", () => {
    const hook = renderHook(() => useSpaceBarPan());
    act(() => { keydown(window, "KeyA"); });
    expect(hook.result.current.isSpacePressed).toBe(false);
  });

  it("does not hijack space while typing in a field", () => {
    const hook = renderHook(() => useSpaceBarPan());
    for (const tag of ["input", "textarea"] as const) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      let evt!: KeyboardEvent;
      act(() => { evt = keydown(el); });
      expect(hook.result.current.isSpacePressed).toBe(false);
      expect(evt.defaultPrevented).toBe(false);
      el.remove();
    }
  });

  it("does not hijack space in contenteditable content", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    // jsdom does not derive `isContentEditable` from the attribute, so set the
    // property a real browser would expose.
    Object.defineProperty(el, "isContentEditable", { value: true });
    document.body.appendChild(el);
    act(() => { keydown(el); });
    expect(hook.result.current.isSpacePressed).toBe(false);
    el.remove();
  });

  it("leaves Space to a mouse-focused button too", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const btn = document.createElement("button");
    btn.matches = ((sel: string) => sel !== ":focus-visible") as unknown as typeof btn.matches;
    document.body.appendChild(btn);
    let evt!: KeyboardEvent;
    act(() => { evt = keydown(btn); });
    expect(hook.result.current.isSpacePressed).toBe(false);
    expect(evt.defaultPrevented).toBe(false);
    btn.remove();
  });

  it("leaves space to a keyboard-focused button", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const btn = document.createElement("button");
    btn.matches = ((sel: string) => sel === ":focus-visible") as unknown as typeof btn.matches;
    document.body.appendChild(btn);
    let evt!: KeyboardEvent;
    act(() => { evt = keydown(btn); });
    expect(hook.result.current.isSpacePressed).toBe(false);
    expect(evt.defaultPrevented).toBe(false);
    btn.remove();
  });

  it("leaves Space to custom ARIA widgets", () => {
    const hook = renderHook(() => useSpaceBarPan());
    for (const role of [
      "switch",
      "radio",
      "combobox",
      "menuitem",
      "tab",
      "menu",
      "tree",
      "grid",
      "tablist",
      "radiogroup",
      "toolbar",
    ]) {
      const el = document.createElement("div");
      el.setAttribute("role", role);
      document.body.appendChild(el);
      let evt!: KeyboardEvent;
      act(() => { evt = keydown(el); });
      expect(hook.result.current.isSpacePressed).toBe(false);
      expect(evt.defaultPrevented).toBe(false);
      el.remove();
    }
  });

  it("leaves Space to custom canvas chrome", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const chrome = document.createElement("div");
    chrome.setAttribute("data-gc-chrome", "");
    document.body.appendChild(chrome);
    let evt!: KeyboardEvent;
    act(() => { evt = keydown(chrome); });
    expect(hook.result.current.isSpacePressed).toBe(false);
    expect(evt.defaultPrevented).toBe(false);
    chrome.remove();
  });

  it("respects a descendant that already prevented Space", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const el = document.createElement("div");
    el.addEventListener("keydown", (event) => event.preventDefault());
    document.body.appendChild(el);
    let evt!: KeyboardEvent;
    act(() => { evt = keydown(el); });
    expect(evt.defaultPrevented).toBe(true);
    expect(hook.result.current.isSpacePressed).toBe(false);
    el.remove();
  });

  it("stops listening after unmount", () => {
    const hook = renderHook(() => useSpaceBarPan());
    const ref = hook.result.current.spacePressedRef;
    hook.unmount();
    act(() => { keydown(window); });
    expect(ref.current).toBe(false);
  });
});

// ─── useOverlayDrag ───────────────────────────────────────────────────────────

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, ...init,
  });
}

/** Mounts a div wired to useOverlayDrag, returning the element and the spies. */
function OverlayHarness({
  onDrag,
  getStartState,
}: {
  onDrag: (s: { v: number }, dx: number, dy: number) => void;
  getStartState: () => { v: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayDrag([{ ref, getStartState, onDrag }]);
  return <div ref={ref} data-testid="handle" data-gc-drag-handle />;
}

describe("useOverlayDrag", () => {
  it("reports pixel deltas from the press point", () => {
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    const { container } = render(
      <OverlayHarness onDrag={onDrag} getStartState={() => ({ v: 7 })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 130, clientY: 80 }));
    });
    expect(onDrag).toHaveBeenCalledWith({ v: 7 }, 30, -20);
  });

  it("snapshots the start state once per gesture", () => {
    let live = 0;
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    const { container } = render(
      <OverlayHarness onDrag={onDrag} getStartState={() => ({ v: live })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    });
    live = 99; // changes mid-drag; the snapshot must not follow it
    act(() => {
      el.dispatchEvent(pointer("pointermove", { clientX: 10, clientY: 0 }));
    });
    expect(onDrag).toHaveBeenCalledWith({ v: 0 }, 10, 0);
  });

  it("swallows the gesture so it cannot also pan the canvas", () => {
    const { container } = render(
      <OverlayHarness onDrag={() => {}} getStartState={() => ({ v: 0 })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    const down = pointer("pointerdown", { clientX: 0, clientY: 0 });
    act(() => { el.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
  });

  it("stops dragging after release", () => {
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    const { container } = render(
      <OverlayHarness onDrag={onDrag} getStartState={() => ({ v: 0 })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointerup", { clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 50, clientY: 50 }));
    });
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("stops dragging on cancel", () => {
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    const { container } = render(
      <OverlayHarness onDrag={onDrag} getStartState={() => ({ v: 0 })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
      el.dispatchEvent(pointer("pointercancel", {}));
      el.dispatchEvent(pointer("pointermove", { clientX: 50, clientY: 50 }));
    });
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("ignores moves that never began with a press", () => {
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    const { container } = render(
      <OverlayHarness onDrag={onDrag} getStartState={() => ({ v: 0 })} />
    );
    const el = container.querySelector('[data-testid="handle"]')!;
    act(() => {
      el.dispatchEvent(pointer("pointermove", { clientX: 50, clientY: 50 }));
    });
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("attaches listeners when handle element mounts dynamically", () => {
    const onDrag = vi.fn<(s: { v: number }, dx: number, dy: number) => void>();
    function DynamicHarness({ show }: { show: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useOverlayDrag([{ ref, getStartState: () => ({ v: 42 }), onDrag }]);
      return show ? <div ref={ref} data-testid="dyn-handle" /> : null;
    }

    const { rerender, container } = render(<DynamicHarness show={false} />);
    expect(container.querySelector('[data-testid="dyn-handle"]')).toBeNull();

    rerender(<DynamicHarness show={true} />);
    const el = container.querySelector('[data-testid="dyn-handle"]')!;
    expect(el).not.toBeNull();
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};

    act(() => {
      el.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 10 }));
      el.dispatchEvent(pointer("pointermove", { clientX: 25, clientY: 15 }));
    });
    expect(onDrag).toHaveBeenCalledWith({ v: 42 }, 15, 5);
  });
});

// ─── useViewportSize ──────────────────────────────────────────────────────────

/** Captures the observer callback so the test can drive resizes. */
function stubResizeObserver() {
  const state: { cb?: ResizeObserverCallback; observed: Element[]; disconnected: boolean } = {
    observed: [],
    disconnected: false,
  };
  class RO {
    constructor(cb: ResizeObserverCallback) { state.cb = cb; }
    observe(el: Element) { state.observed.push(el); }
    unobserve() {}
    disconnect() { state.disconnected = true; }
  }
  vi.stubGlobal("ResizeObserver", RO as unknown as typeof ResizeObserver);
  return state;
}

const roEntry = (width: number, height: number) =>
  [{ contentRect: { width, height } } as ResizeObserverEntry];

describe("useViewportSize", () => {
  it("stays null until an element exists", () => {
    stubResizeObserver();
    const hook = renderHook(() => useViewportSize({ current: null }));
    expect(hook.result.current).toBeNull();
  });

  it("reports the observed box", () => {
    const ro = stubResizeObserver();
    const el = document.createElement("div");
    const hook = renderHook(() => useViewportSize({ current: el }));
    expect(ro.observed).toContain(el);

    act(() => { ro.cb!(roEntry(640, 480), {} as ResizeObserver); });
    expect(hook.result.current).toEqual({ width: 640, height: 480 });
  });

  it("tracks subsequent resizes", () => {
    const ro = stubResizeObserver();
    const hook = renderHook(() => useViewportSize({ current: document.createElement("div") }));
    act(() => { ro.cb!(roEntry(100, 100), {} as ResizeObserver); });
    act(() => { ro.cb!(roEntry(200, 300), {} as ResizeObserver); });
    expect(hook.result.current).toEqual({ width: 200, height: 300 });
  });

  it("disconnects the observer on unmount", () => {
    const ro = stubResizeObserver();
    const hook = renderHook(() => useViewportSize({ current: document.createElement("div") }));
    hook.unmount();
    expect(ro.disconnected).toBe(true);
  });
});

// ─── link/context ─────────────────────────────────────────────────────────────

describe("GraphLink context", () => {
  it("returns null with no provider", () => {
    const hook = renderHook(() => useGraphLink());
    expect(hook.result.current).toBeNull();
  });

  it("provides the link to descendants", () => {
    const link = createGraphLink();
    const hook = renderHook(() => useGraphLink(), {
      wrapper: ({ children }) => <GraphLinkProvider link={link}>{children}</GraphLinkProvider>,
    });
    expect(hook.result.current).toBe(link);
  });

  it("useGraphLinkState selects from the shared store and re-renders on publish", () => {
    const link = createGraphLink();
    const hook = renderHook(() => useGraphLinkState(link, (s) => s.sources.A?.hoverKey ?? null));
    expect(hook.result.current).toBeNull();

    act(() => {
      link.store.getState().publish("A", { selectedKeys: [], hoverKey: "n1" });
    });
    expect(hook.result.current).toBe("n1");
  });

  it("does not change the selected value on a deduped publish", () => {
    const link = createGraphLink();
    const hook = renderHook(() => useGraphLinkState(link, (s) => s.sources));
    act(() => {
      link.store.getState().publish("A", { selectedKeys: ["x"], hoverKey: null });
    });
    const first = hook.result.current;
    act(() => {
      link.store.getState().publish("A", { selectedKeys: ["x"], hoverKey: null });
    });
    expect(hook.result.current).toBe(first);
  });
});
