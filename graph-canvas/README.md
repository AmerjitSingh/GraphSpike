# graph-canvas

A React component for node-edge graphs. Nodes and edges are drawn on canvas, so
large graphs stay responsive; a node you interact with is swapped for real DOM
so it can contain ordinary React content.

## Install

```bash
npm install @graphspike/graph-canvas react react-dom
```

```tsx
import { GraphCanvas } from "@graphspike/graph-canvas";

const nodes = [
  { id: "1", data: { label: "React" } },
  { id: "2", data: { label: "Node.js" } },
];
const edges = [{ id: "e1", source: "1", target: "2", data: { label: "runs on" } }];

<div style={{ width: "100%", height: 600 }}>
  <GraphCanvas nodes={nodes} edges={edges} />
</div>
```

The component fills its parent, so the parent needs a height.

## How nodes are drawn

There are two node layers, and a node moves between them:

- **Canvas** — the default. Draw with `renderCanvasNode({ ctx, node, x, y,
  radius, zoom })`. Fast, but it is paint: no DOM, no events of its own.
- **DOM** — used once a node is selected. Draw with `renderNode(props)`. Normal
  React, so inputs, popovers and portals work.

Write both if you use either, or the node will change appearance when selected.
Set `renderAllNodes` to keep everything in the DOM layer (fine for small graphs).

Edges are canvas only. Hit-testing for both is done against an R-tree rather
than the DOM.

## Props

### Data

| Prop | Type | Notes |
|---|---|---|
| `nodes` | `GraphNode<T>[]` | `{ id, data }` |
| `edges` | `GraphEdge<E>[]` | `{ id, source, target, data }` |
| `initialPositions` | `Record<string, NodePosition>` | Seed only — applied to nodes with no position, so it never drags placed nodes back. Remount with a new `key` to reset layout. |
| `graphRef` | `Ref<GraphCanvasRef>` | `fitToView()`, `panTo(x, y, zoom?)`, `panToNode(id, zoom?)`, `zoomIn()`, `zoomOut()`, `getZoom()` |

### Nodes

| Prop | Type |
|---|---|
| `renderNode` | `(props) => ReactNode` — the DOM layer |
| `renderCanvasNode` | `(props) => boolean \| void` — return `true` if you drew it yourself |
| `getNodeRadius` | `(node) => number`, default 40 |
| `getNodeSize` | `(node) => NodeSize` — the box ports sit on |
| `getNodeShape` | `(node) => string` — `"rectangle"` changes the default canvas shape and widens hit-testing to the drawn rectangle |
| `getNodeAnchor` | `(props) => NodePosition` — where edges attach |
| `getNodeLabel` | `(node) => string` — accessible name; defaults to `data.label`, then `id` |

`renderNode` gets `{ node, isSelected, isHighlighted, isDragging, isFocused,
isConnectSource, zoom }`.

Form controls, links, `[contenteditable]`, ARIA widget roles and anything marked
`data-gc-no-drag` will not start a node drag.

### Edges

| Prop | Type |
|---|---|
| `getEdgeStyle` | `(edge) => EdgeStyle` — `stroke`, `strokeWidth`, `strokeDasharray`, `markerEnd` |
| `getEdgeRoute` | `(props) => "straight" \| "curved" \| "s-curved" \| "angled"` |
| `getEdgeCurveStrength` | `(props) => number`, default 1 |
| `getEdgeControlPoints` | `(props) => { c1?, c2? }` |
| `getEdgeLabel` | `(edge) => string` |
| `renderEdgeToolbar` | `(props) => ReactNode` — shown after hovering an edge for `edgeToolbarDelay` ms (600) |

Route callbacks get `phase: "edge" | "preview"`, so a drag preview can look
different from a committed edge.

### Ports and connections

Give a node ports with `getNodePorts`, and draw them with `renderPort` (DOM) or
`renderCanvasPort` (canvas). A `PortDef` is `{ id, type, mode, label?,
maxConnections?, side?, behavior?, required? }`.

`onConnect` receives `{ source, sourcePort?, target, targetPort? }` and only
fires if the connection passes, in order:

1. Both ends are real nodes.
2. An end must name a port if its node has one **for that direction**. A node
   with only output ports still accepts an incoming edge at its perimeter.
3. Edges run output → input.
4. Both ports must have the same `type`.
5. Neither port may exceed its `maxConnections` — only checked if you pass `edges`.
6. `isValidConnection({ ...connection, sourceNode, targetNode, sourcePortDef,
   targetPortDef })`, if given.

`isValidConnection` can only narrow this further; it cannot allow something the
rules above rejected. The same check runs for mouse and keyboard, so they can't
disagree.

### Layout

`layoutEnabled` (true), `layoutLinkDistance` (140), `layoutChargeStrength` (-400).

A d3-force simulation runs in a worker and only places nodes that have no
position yet. It gives up ownership of a node as soon as you move it, so
dragging during a simulation isn't undone. Over 2000 nodes it skips the
simulation and uses a ring layout. If the worker fails, nodes get the ring
layout rather than nothing.

### Selection

`selectedNodeIds` + `onSelectionChange`, or leave it uncontrolled. When
controlled, an interaction only proposes a selection — if the parent doesn't
apply it, the internal state snaps back so later interactions don't build on a
value the parent refused.

Edge selection is controlled only: `selectedEdgeIds`, plus `onEdgeClick` /
`onEdgeActivate`.

### Events

`onNodeMove`, `onNodeClick`, `onNodeDoubleClick`, `onNodeHover`, `onEdgeClick`,
`onEdgeHover`, `onEdgeActivate`, `onConnect`, `onCanvasDoubleClick`,
`onPositionsChange`, `onExternalDrop`.

`onPositionsChange` only fires on a settled state — not during a drag, and once
at the end of a simulation rather than per tick.

### Chrome and interaction

`marqueeSelect`, `panOnDrag`, `snapToGrid`, `showFitView` (true),
`showZoomControls`, `showMinimap`, `showBackground` (`"dots" | "grid"`),
`keyboardNav` (true), `renderContextMenu`, `renderAllNodes`.

Anything you pass as `children` is treated as an overlay and won't also click
the node underneath it. Give it `pointerEvents: "none"` if you want clicks to
pass through.

## Controls

| Input | Action |
|---|---|
| Drag a node | Move it, and the rest of the selection if it's selected |
| Click / Shift-click | Select / toggle |
| Drag blank canvas | Marquee, with `marqueeSelect` |
| Wheel | Zoom |
| Space-drag, middle-drag | Pan |
| Touch drag | Same as a left-drag |
| Right-click | Context menu, with `renderContextMenu` |
| Drag a port | Start an edge |
| Arrows | Move focus between nodes, or between edges |
| Enter / Space | Select the focused node (Shift adds), or activate the focused edge |
| Alt + arrows | Move the selection; Shift for a bigger step |
| `c` | Start connecting from the focused node |
| `[` `]` | Choose which ports that connection uses |
| Home / End | First / last |
| Escape | Cancel a connection, otherwise clear the selection |

Left-drag on *blank canvas* is claimed by `marqueeSelect` before `panOnDrag`,
because panning still has space-drag and middle-drag while marquee has nothing
else. On a node, `panOnDrag` still wins — that is what it is for.

## Accessibility

The canvas layers are `aria-hidden`. Nodes and edges are mirrored into two
hidden listboxes of real buttons, which is what makes them focusable and
readable. Only a window of nodes around the focused one is rendered, so a large
graph doesn't produce thousands of buttons.

A node can have several inputs, so `c` collects every valid port pairing and
`[` / `]` cycle them; the current one is announced ("connecting to Agent from
out to Chat Model, option 2 of 3").

## Multiple graphs

Each `<GraphCanvas>` has its own store, so graphs on one page don't share
positions, selection or viewport. To link them, wrap them in a
`GraphLinkProvider` and give each a `linkId`: selection and hover then highlight
the same entity across graphs, `crossGraphDrag` allows dragging between them,
and `link.graph(id)` returns a peer's imperative handle. `toLinkKey` maps local
ids to a shared key.

## Storage

There isn't any — persist it yourself:

```tsx
<GraphCanvas
  nodes={nodes}
  edges={edges}
  initialPositions={savedPositions}
  onNodeMove={(id, x, y) => db.updateNodePosition(id, x, y)}
  onConnect={(c) => db.createEdge(c.source, c.target, c.sourcePort, c.targetPort)}
/>
```

## Building

`npm run build` in this directory compiles ES modules and declarations to
`dist/` (`tsconfig.build.json`). `prepack` runs it, so `npm pack` and
`npm publish` always ship a fresh build. Tests, source files and source maps are
excluded from the tarball.

The package targets ES2022 and keeps `"use client"` directives, so it works
unbundled in a React Server Components app.

Relative imports in the source carry an explicit `.js` extension
(`from "./store.js"`, not `from "./store"`), because Node's ESM resolver does no
extension probing and `tsc` never rewrites a specifier. TypeScript maps those
back to the `.ts`/`.tsx` file, and `moduleResolution: "NodeNext"` makes an
extensionless relative import a compile error — so the published output is
resolvable by construction.

## Tests

From the repository root, `npm run check` runs typecheck, lint and tests, while
`npm run test:coverage` adds the coverage thresholds.

Tests are in `__tests__/` and use the node environment by default. DOM tests opt
in with a `// @vitest-environment jsdom` docblock and `import "./setup.dom"`.
`setup.canvas.ts` is a separate opt-in that records canvas draw calls.

Built on d3-force, d3-zoom, rbush and zustand.

Apache-2.0.
