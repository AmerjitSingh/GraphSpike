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

/**
 * How many nodes may occupy the DOM layer at once.
 *
 * Promotion is what makes `renderNode` work, but it costs two DOM elements and
 * a React subtree per node, and a group drag rewrites every promoted node's
 * position each frame — so the cost is paid per frame, not just at mount.
 * Selecting every node of a large graph would otherwise materialise the whole
 * graph as DOM, which is precisely the thing canvas rendering exists to avoid.
 *
 * Above this budget the surplus stays on the canvas layer, still drawn with its
 * selected styling and still draggable through `useCanvasNodeDrag` — it only
 * loses its custom React body. Sized to comfortably cover a screenful of nodes
 * at a working zoom, where promotion is actually visible to the user.
 */
export const MAX_PROMOTED_NODES = 300;

/** Graph-space slack added around the viewport when choosing which selected
 *  nodes to promote, so a node whose centre is just off-screen but whose body
 *  still overlaps the edge keeps its DOM. Only ever over-includes: a node
 *  wrongly promoted is invisible extra work, one wrongly dropped is a visible
 *  loss of its rendered content. */
export const PROMOTE_CULL_MARGIN = 160;
