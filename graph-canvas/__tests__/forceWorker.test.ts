import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `forceWorker.ts` registers `self.addEventListener("message", …)` at module
 * scope and is only ever loaded by `new Worker(...)` in the app, so it is never
 * imported in-process. Here we stub `self`, import the module dynamically so
 * its registration binds to the stub, then invoke the captured handler directly.
 */

type PostedMessage = { type: string; [k: string]: unknown };

interface WorkerPayload {
  nodes: { id: string; x?: number; y?: number }[];
  edges: { source: string; target: string }[];
  fixedIds: string[];
  linkDistance: number;
  chargeStrength: number;
  nodeRadii: { id: string; r: number }[];
  totalTicks: number;
}

type MessageHandler = (event: { data: WorkerPayload }) => void;

let posted: { message: PostedMessage; options?: { transfer?: unknown[] } }[] = [];
const captured: { handler: MessageHandler | null } = { handler: null };

// The explicit return type matters: TypeScript cannot see the assignment that
// happens inside the addEventListener callback, so it would otherwise narrow
// the captured handler to `never` and report the call sites as uncallable.
async function loadWorker(): Promise<MessageHandler> {
  posted = [];
  captured.handler = null;
  vi.resetModules();
  vi.stubGlobal("self", {
    addEventListener: (type: string, fn: MessageHandler) => {
      if (type === "message") captured.handler = fn;
    },
    postMessage: (message: PostedMessage, options?: { transfer?: unknown[] }) => {
      posted.push({ message, options });
    },
  });
  await import("../hooks/forceWorker");
  const registered = captured.handler;
  if (!registered) throw new Error("forceWorker did not register a message handler");
  return registered;
}

function payload(over: Partial<WorkerPayload> = {}): WorkerPayload {
  return {
    nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }],
    edges: [],
    fixedIds: [],
    linkDistance: 140,
    chargeStrength: -400,
    nodeRadii: [{ id: "a", r: 40 }, { id: "b", r: 40 }],
    totalTicks: 20,
    ...over,
  };
}

const typesOf = () => posted.map((p) => p.message.type);
const ticks = () => posted.filter((p) => p.message.type === "tick");

beforeEach(() => {
  posted = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forceWorker — message cadence", () => {
  it("emits ceil(totalTicks/20) ticks then a single end", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 50 }) });
    expect(typesOf()).toEqual(["tick", "tick", "tick", "end"]);
  });

  it("emits one tick for an exact chunk", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 20 }) });
    expect(typesOf()).toEqual(["tick", "end"]);
  });

  it("emits a partial final chunk", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 25 }) });
    expect(typesOf()).toEqual(["tick", "tick", "end"]);
  });

  it("emits only end for zero ticks", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 0 }) });
    expect(typesOf()).toEqual(["end"]);
  });

  it("does not hang on a non-numeric tick count", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: Number.NaN }) });
    expect(typesOf()).toEqual(["end"]);
  });
});

describe("forceWorker — tick payloads", () => {
  it("packs x/y pairs in node order", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 20 }) });
    const updates = ticks()[0].message.updates as Float32Array;
    expect(updates).toBeInstanceOf(Float32Array);
    expect(updates.length).toBe(4);
  });

  it("transfers the underlying buffer", async () => {
    const run = await loadWorker();
    run({ data: payload({ totalTicks: 20 }) });
    const { message, options } = ticks()[0];
    expect(options?.transfer).toHaveLength(1);
    expect(options?.transfer?.[0]).toBe((message.updates as Float32Array).buffer);
  });

  it("emits an empty array for an empty graph but still ends", async () => {
    const run = await loadWorker();
    run({ data: payload({ nodes: [], nodeRadii: [], totalTicks: 20 }) });
    expect((ticks()[0].message.updates as Float32Array).length).toBe(0);
    expect(typesOf()).toContain("end");
  });
});

describe("forceWorker — fixed nodes", () => {
  it("pins a node listed in fixedIds to its supplied coordinates", async () => {
    const run = await loadWorker();
    run({
      data: payload({
        nodes: [{ id: "a", x: 500, y: -250 }, { id: "b", x: 0, y: 0 }],
        fixedIds: ["a"],
        totalTicks: 40,
      }),
    });
    const last = ticks().at(-1)!.message.updates as Float32Array;
    expect(last[0]).toBeCloseTo(500);
    expect(last[1]).toBeCloseTo(-250);
  });

  it("pins a fixed node that supplied no coordinates at the origin", async () => {
    // Regression: `fx` was set from the raw `n.x` while `x` defaulted to 0, so
    // a fixed node without coordinates was left unpinned and drifted away.
    const run = await loadWorker();
    run({
      data: payload({
        nodes: [{ id: "a" }, { id: "b", x: 50, y: 50 }],
        fixedIds: ["a"],
        totalTicks: 60,
      }),
    });
    const last = ticks().at(-1)!.message.updates as Float32Array;
    expect(last[0]).toBe(0);
    expect(last[1]).toBe(0);
  });
});

describe("forceWorker — error reporting", () => {
  it("reports an edge naming an unknown node instead of dying silently", async () => {
    // Regression: d3 validates the graph while the forces are constructed, which
    // used to sit outside the try — the throw escaped the handler, so the host
    // never received "error" or "end" and its transient phase stayed open.
    const run = await loadWorker();
    run({
      data: payload({
        edges: [{ source: "a", target: "ghost" }],
        totalTicks: 20,
      }),
    });
    expect(typesOf()).toEqual(["error"]);
    expect(String(posted[0].message.error)).toMatch(/ghost/);
  });

  it("does not emit end after an error", async () => {
    const run = await loadWorker();
    run({ data: payload({ edges: [{ source: "nope", target: "a" }] }) });
    expect(typesOf()).not.toContain("end");
  });
});

describe("forceWorker — collision radius", () => {
  it("separates coincident nodes using the supplied radii", async () => {
    const run = await loadWorker();
    run({
      data: payload({
        nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }],
        nodeRadii: [{ id: "a", r: 40 }, { id: "b", r: 40 }],
        totalTicks: 120,
      }),
    });
    const last = ticks().at(-1)!.message.updates as Float32Array;
    const separation = Math.hypot(last[0] - last[2], last[1] - last[3]);
    expect(separation).toBeGreaterThan(50);
  });

  it("falls back to the default radius for ids missing from nodeRadii", async () => {
    const run = await loadWorker();
    run({
      data: payload({
        nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }],
        nodeRadii: [],
        totalTicks: 120,
      }),
    });
    const last = ticks().at(-1)!.message.updates as Float32Array;
    const separation = Math.hypot(last[0] - last[2], last[1] - last[3]);
    // Default 40 + 8 padding each side.
    expect(separation).toBeGreaterThan(50);
  });
});
