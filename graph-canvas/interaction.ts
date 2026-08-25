/**
 * Shared "whose event is this?" predicates.
 *
 * The graph listens at the container, so nearly every pointer and key event it
 * sees arrived by bubbling from something more specific — a control inside a
 * node, an overlay button, the accessibility layer. These predicates are how
 * each subsystem decides to keep its hands off. They live here rather than
 * beside their first caller so the node layer, the canvas chrome and the
 * keyboard handler can all share one definition without importing each other.
 */

/**
 * Content inside a node that must receive its own pointer events rather than
 * starting a node drag: native form controls, links, editable regions, and
 * anything the consumer marks with `data-gc-no-drag`.
 */
export const NO_DRAG_SELECTOR =
  "[data-gc-no-drag], input, textarea, select, option, button, a[href], label, summary, video, audio, iframe, [contenteditable]:not([contenteditable='false'])";

/** ARIA widgets that own pointer, wheel and keyboard input. Consumers often
 * render these as a plain `div`, so native-tag checks alone are insufficient. */
const INTERACTIVE_ROLE_SELECTOR = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "switch",
  "radio",
  "slider",
  "spinbutton",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "gridcell",
  "scrollbar",
  // Composite widgets own input on their padding/container as well as on
  // their individual child items.
  "menu",
  "menubar",
  "tree",
  "treegrid",
  "grid",
  "tablist",
  "radiogroup",
  "toolbar",
].map((role) => `[role="${role}"]`).join(", ");

export function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  // `isContentEditable` handles inherited editability and every valid value,
  // including `plaintext-only`; the selector remains for DOM shims such as
  // jsdom that do not derive the property from the attribute.
  if (el.isContentEditable) return true;
  if (el.closest(NO_DRAG_SELECTOR)) return true;
  return !!el.closest(INTERACTIVE_ROLE_SELECTOR);
}

/**
 * Canvas chrome: overlay UI that sits above the graph and owns its own
 * interactions. Every graph-level pointer handler (click, double-click,
 * context menu, marquee, hover) and the d3 zoom filter must ignore events
 * originating here, or the graph reacts to clicks meant for the controls.
 */
export const GC_CHROME_SELECTOR =
  "[data-gc-minimap], [data-gc-context-menu], [data-gc-chrome]";

/** True when a target lives in canvas chrome rather than graph content. */
export function isChromeTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.(GC_CHROME_SELECTOR);
}

/** True when an event started inside canvas chrome rather than the graph. */
export function isChromeEvent(e: { target: EventTarget | null }): boolean {
  return isChromeTarget(e.target);
}

/** A target whose primary pointer sequence belongs to UI layered over or
 * inside the graph, including consumer-defined drag handles. */
export function isPrimaryGestureControlTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    isChromeTarget(target) ||
    isInteractiveTarget(target) ||
    !!el?.closest?.("[data-gc-drag-handle]")
  );
}

export type PrimaryGestureOwner = "control" | "pan" | "connect" | "node" | "marquee" | "none";

interface PrimaryGestureOwnerOptions {
  target: EventTarget | null;
  /** Spatial hit-test result. This is what makes canvas-painted nodes equivalent
   * to promoted DOM nodes for gesture ownership. */
  pointOnNode: boolean;
  spacePressed: boolean;
  panOnDrag: boolean;
  marqueeSelect: boolean;
}

/**
 * Resolve one owner for a primary press. Both React's pointer handlers and
 * d3-zoom use this decision, so a press cannot become a marquee in one layer
 * and a pan in the other.
 */
export function resolvePrimaryGestureOwner({
  target,
  pointOnNode,
  spacePressed,
  panOnDrag,
  marqueeSelect,
}: PrimaryGestureOwnerOptions): PrimaryGestureOwner {
  const el = target as HTMLElement | null;
  const onPort = !!el?.closest?.("[data-gc-handle]");
  const onNode = pointOnNode || !!el?.closest?.("[data-gc-node]");
  const ownsPointer = isPrimaryGestureControlTarget(target);

  // A focused/pressed control always keeps its own gesture. Space-pan is a
  // canvas shortcut, not permission to drag a slider or button underneath it.
  if (ownsPointer) return "control";
  // Space is the explicit pan override, including when the pointer is over a
  // connector. NodeLayer declines the connection while Space is active.
  if (spacePressed) return "pan";
  if (onPort) return "connect";
  if (panOnDrag) {
    // Marquee has no alternate gesture, so it owns blank space when both are
    // enabled. A node body still pans, consistently in DOM and canvas layers.
    return marqueeSelect && !onNode ? "marquee" : "pan";
  }
  if (onNode) return "node";
  if (marqueeSelect) return "marquee";
  return "none";
}

/** The accessibility layer's own focusable node and edge buttons. These *are*
 *  the keyboard interface to the graph, so unlike other buttons they must not
 *  be treated as consumer controls to be left alone. */
export const GC_A11Y_NODE_SELECTOR = "[data-gc-a11y-node], [data-gc-a11y-edge]";

/**
 * True when a key event belongs to something other than the graph itself.
 *
 * The container has no `tabIndex`, so every keydown it sees bubbled up from a
 * descendant — a consumer's `<input>` inside `renderNode`, an overlay button,
 * a port menu. Without this the graph's single-letter shortcuts swallow
 * ordinary typing and its arrow keys fight the caret.
 */
export function isForeignKeyTarget(e: { target: EventTarget | null }): boolean {
  const el = e.target as HTMLElement | null;
  if (!el?.closest) return false;
  // The a11y layer is the graph's own keyboard surface, not foreign chrome.
  if (el.closest(GC_A11Y_NODE_SELECTOR)) return false;
  return isInteractiveTarget(el) || isChromeEvent(e);
}
