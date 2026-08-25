/**
 * jsdom shims for the browser APIs GraphCanvas depends on but jsdom lacks.
 * Kept deliberately small: enough for the component to mount and dispatch
 * pointer events, without pretending to render pixels.
 */
import { vi } from "vitest";

// useViewportSize observes the container; jsdom has no ResizeObserver.
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(_target: Element) {
    // Report a fixed, non-zero box so layers mount and geometry is finite.
    this.cb(
      [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Canvas layers bail out cleanly when getContext returns null, which is what
// jsdom does by default — but it warns loudly, so stub it to a no-op context.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn<() => null>(() => null) as never;
}

// Elements are laid out at 0x0 in jsdom; give the graph container a real box.
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} };
};

// Pointer capture isn't implemented in jsdom.
Element.prototype.setPointerCapture ??= function () {};
Element.prototype.releasePointerCapture ??= function () {};
Element.prototype.hasPointerCapture ??= function () {
  return false;
};

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame ??= ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
