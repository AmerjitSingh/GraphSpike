/**
 * Opt-in recording fake for the 2D canvas context.
 *
 * `setup.dom.ts` deliberately makes `getContext` return null so the draw
 * effects short-circuit for every other jsdom test. Import THIS file (in
 * addition to setup.dom) only in tests that want the draw paths to execute,
 * and assert against the recorded call log rather than pixels.
 */

export interface DrawCall {
  op: string;
  args: unknown[];
}

export interface RecordingContext {
  calls: DrawCall[];
  /** Every op name in order, for coarse sequence assertions. */
  ops(): string[];
  count(op: string): number;
  argsFor(op: string): unknown[][];
  reset(): void;
}

const NOOP_METHODS = [
  "setTransform", "clearRect", "beginPath", "closePath", "save", "restore",
  "moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo", "arc", "arcTo",
  "rect", "roundRect", "fill", "stroke", "fillText", "strokeText",
  "setLineDash", "getLineDash", "translate", "scale", "rotate", "clip",
  "drawImage", "putImageData", "fillRect", "strokeRect",
] as const;

/** Installs the fake on HTMLCanvasElement and returns the shared recorder. */
export function installRecordingCanvas(): RecordingContext {
  const calls: DrawCall[] = [];

  const recorder: RecordingContext = {
    calls,
    ops: () => calls.map((c) => c.op),
    count: (op) => calls.filter((c) => c.op === op).length,
    argsFor: (op) => calls.filter((c) => c.op === op).map((c) => c.args),
    reset: () => {
      calls.length = 0;
    },
  };

  const makeContext = () => {
    const ctx: Record<string, unknown> = {
      canvas: null,
      // Style properties are plain assignable fields.
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
      textAlign: "start", textBaseline: "alphabetic", lineCap: "butt",
      lineJoin: "miter", globalAlpha: 1,
    };
    for (const op of NOOP_METHODS) {
      ctx[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        if (op === "getLineDash") return [];
        return undefined;
      };
    }
    // Text metrics are read to decide truncation; return a width proportional
    // to the string so the "too wide" branch is reachable.
    ctx.measureText = (text: string) => {
      calls.push({ op: "measureText", args: [text] });
      return { width: String(text).length * 8 };
    };
    ctx.createLinearGradient = (...args: unknown[]) => {
      calls.push({ op: "createLinearGradient", args });
      return { addColorStop: () => {} };
    };
    return ctx as unknown as CanvasRenderingContext2D;
  };

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const ctx = makeContext() as CanvasRenderingContext2D & { canvas: HTMLCanvasElement };
    ctx.canvas = this;
    return ctx;
  } as unknown as HTMLCanvasElement["getContext"];

  return recorder;
}
