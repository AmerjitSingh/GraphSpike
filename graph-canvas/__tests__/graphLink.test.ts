import { describe, it, expect, vi } from "vitest";
import { createGraphLink, resolveExternalDropHandler } from "../link/GraphLink";
import type { ExternalDropHandler, GraphLinkRegistration } from "../link/GraphLink";

function registration(over: Partial<GraphLinkRegistration> = {}): GraphLinkRegistration {
  return {
    getHandle: () => null,
    getContainer: () => null,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getOnExternalDrop: () => undefined,
    ...over,
  };
}

describe("resolveExternalDropHandler", () => {
  it("prefers the live getter", () => {
    const fresh = vi.fn<ExternalDropHandler>();
    const stale = vi.fn<ExternalDropHandler>();
    const reg = registration({ getOnExternalDrop: () => fresh, onExternalDrop: stale });
    expect(resolveExternalDropHandler(reg)).toBe(fresh);
  });

  it("falls back to a legacy registration that only has onExternalDrop", () => {
    // Registrations written before getOnExternalDrop existed (or hand-built in
    // plain JS) must keep working rather than throwing on a missing method.
    const legacy = vi.fn<ExternalDropHandler>();
    const reg = { ...registration(), getOnExternalDrop: undefined, onExternalDrop: legacy };
    expect(resolveExternalDropHandler(reg)).toBe(legacy);
  });

  it("returns undefined when a registration accepts no drops at all", () => {
    const reg = { ...registration(), getOnExternalDrop: undefined, onExternalDrop: undefined };
    expect(resolveExternalDropHandler(reg)).toBeUndefined();
  });

  it("does not throw for a registration missing both fields", () => {
    const bare = {
      getHandle: () => null,
      getContainer: () => null,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    } as GraphLinkRegistration;
    expect(() => resolveExternalDropHandler(bare)).not.toThrow();
    expect(resolveExternalDropHandler(bare)).toBeUndefined();
  });
});

describe("createGraphLink — publish", () => {
  it("dedupes identical publishes so peers don't re-render", () => {
    const link = createGraphLink();
    link.store.getState().publish("A", { selectedKeys: ["x"], hoverKey: null });
    const first = link.store.getState().sources;
    link.store.getState().publish("A", { selectedKeys: ["x"], hoverKey: null });
    expect(link.store.getState().sources).toBe(first);
  });

  it("publishes when the hover key changes", () => {
    const link = createGraphLink();
    link.store.getState().publish("A", { selectedKeys: [], hoverKey: null });
    const first = link.store.getState().sources;
    link.store.getState().publish("A", { selectedKeys: [], hoverKey: "n1" });
    expect(link.store.getState().sources).not.toBe(first);
    expect(link.store.getState().sources.A.hoverKey).toBe("n1");
  });

  it("clear removes only the named graph", () => {
    const link = createGraphLink();
    link.store.getState().publish("A", { selectedKeys: ["a"], hoverKey: null });
    link.store.getState().publish("B", { selectedKeys: ["b"], hoverKey: null });
    link.store.getState().clear("A");
    expect(link.store.getState().sources.A).toBeUndefined();
    expect(link.store.getState().sources.B).toBeDefined();
  });

  it("clearing an absent graph is a no-op that preserves identity", () => {
    const link = createGraphLink();
    const before = link.store.getState().sources;
    link.store.getState().clear("nope");
    expect(link.store.getState().sources).toBe(before);
  });
});

describe("createGraphLink — registry", () => {
  it("resolves a registered graph's imperative handle", () => {
    const link = createGraphLink();
    const handle = {
      fitToView: vi.fn<() => void>(),
      panTo: vi.fn<(x: number, y: number, zoom?: number, animate?: boolean) => void>(),
      panToNode: vi.fn<(id: string, zoom?: number) => void>(),
      zoomIn: vi.fn<() => void>(),
      zoomOut: vi.fn<() => void>(),
      getZoom: vi.fn<() => number>(() => 1),
    };
    link.register("A", registration({ getHandle: () => handle }));
    expect(link.graph("A")).toBe(handle);
    expect(link.graph("missing")).toBeNull();
  });

  it("unregister only removes its own registration (remount safety)", () => {
    const link = createGraphLink();
    const first = registration();
    const unregisterFirst = link.register("A", first);
    // A remount registers the replacement before the old cleanup runs.
    const second = registration();
    link.register("A", second);
    unregisterFirst();
    expect(link.getRegistration("A")).toBe(second);
    expect(link.listGraphs()).toEqual(["A"]);
  });

  it("reads the external-drop handler at call time, not registration time", () => {
    const link = createGraphLink();
    let handler: ((p: unknown, x: number, y: number) => void) | undefined;
    // Registered while the graph does NOT accept drops.
    link.register("B", registration({ getOnExternalDrop: () => handler }));
    const resolve = () => resolveExternalDropHandler(link.getRegistration("B")!);
    expect(resolve()).toBeUndefined();

    // The consumer attaches a handler later — no re-registration happens.
    const spy = vi.fn<(p: unknown, x: number, y: number) => void>();
    handler = spy;
    expect(resolve()).toBe(spy);

    // ...and detaching it is observed too.
    handler = undefined;
    expect(resolve()).toBeUndefined();
  });
});
