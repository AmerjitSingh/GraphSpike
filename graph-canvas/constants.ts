/**
 * Geometry constants shared by modules that would otherwise import each other.
 *
 * `geometry.ts` already depends on `ports.ts`, so the node radius cannot live
 * in geometry and still be read by ports at module-init time — that is a
 * circular import, and whichever module loaded second would read the constant
 * from the temporal dead zone. Keeping it in a leaf module both can import
 * lets the default node size stay *derived* rather than duplicated.
 */

/** Radius the default renderers draw an unstyled node at, in graph units. */
export const DEFAULT_NODE_RADIUS = 40;

// Default rounded-rectangle node metrics (graph units). Shared by the canvas
// renderer (which draws them) and the spatial index (which must hit-test the
// same box the user sees).
export const RECT_W = 168;
export const RECT_H = 108;
export const RECT_RADIUS = 28;
