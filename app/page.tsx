import Link from "next/link";

const demoPages = [
  {
    href: "/renders/circle",
    title: "Circular Render",
    description:
      "A circular node renderer. Edge anchors follow the radius.",
  },
  {
    href: "/renders/rounded-rectangle",
    title: "Rounded Rectangle Render",
    description:
      "A rounded-rectangle renderer, with edge anchors that follow the shape.",
  },
  {
    href: "/renders/edge-routes",
    title: "Edge Route Types",
    description:
      "Per-edge routing: straight, curved, S-curved and angled.",
  },
  {
    href: "/renders/dashed",
    title: "Dashed Edges",
    description:
      "Dashed edges, via getEdgeStyle.",
  },
  {
    href: "/on-edge-create",
    title: "Creating Edges",
    description:
      "Drag between nodes to create edges. Duplicates are refused.",
  },
  {
    href: "/context-menus",
    title: "Context Menus",
    description:
      "One managed menu for nodes, ports, edges and blank canvas.",
  },
  {
    href: "/graph-editor",
    title: "Graph Editor",
    description:
      "Add and remove nodes and edges, and change edge routes.",
  },
  {
    href: "/preview-phase",
    title: "Preview Phase",
    description:
      "The drag preview and the edge it becomes can use different routes.",
  },
  {
    href: "/mixed-shape-rules",
    title: "Mixed Shape Rules",
    description:
      "Circles and rectangles, with rules about what may connect to what.",
  },
  {
    href: "/large-graph",
    title: "Large Graph",
    description:
      "10,000 nodes and 13,332 edges.",
  },
  {
    href: "/svg-selection",
    title: "Selection",
    description:
      "Click, Shift-click and marquee selection, with group drag.",
  },
  {
    href: "/workflow-nodes",
    title: "Workflow Nodes",
    description:
      "Typed ports declared as data. Mismatched types are refused mid-drag.",
  },
  {
    href: "/linked-graphs",
    title: "Linked Graphs",
    description:
      "Two graphs sharing selection and hover through a GraphLink.",
  },
  {
    href: "/graph-navigator",
    title: "Graph Navigator",
    description:
      "A minimap with a draggable viewport rectangle.",
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px 24px",
        background:
          "radial-gradient(circle at top left, #12305a 0%, #081226 42%, #030712 100%)",
        color: "#e2e8f0",
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
        }}
      >
        <div style={{ maxWidth: 620, marginBottom: 36 }}>
          <div
            style={{
              display: "inline-block",
              marginBottom: 14,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(148, 163, 184, 0.12)",
              color: "#bfdbfe",
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Demo Gallery
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2.5rem, 5vw, 4.4rem)",
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
            }}
          >
            Choose a graph demo.
          </h1>
          <p
            style={{
              margin: "16px 0 0",
              color: "#94a3b8",
              fontSize: 18,
              lineHeight: 1.6,
            }}
          >
            One behaviour per page.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {demoPages.map((demo) => (
            <Link
              key={demo.href}
              href={demo.href}
              style={{
                display: "block",
                padding: 24,
                borderRadius: 28,
                border: "1px solid rgba(148, 163, 184, 0.18)",
                background:
                  "linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(2, 6, 23, 0.92))",
                color: "inherit",
                textDecoration: "none",
                boxShadow: "0 24px 50px rgba(2, 6, 23, 0.35)",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 28,
                  lineHeight: 1.05,
                }}
              >
                {demo.title}
              </h2>
              <p
                style={{
                  margin: "12px 0 24px",
                  color: "#94a3b8",
                  lineHeight: 1.6,
                }}
              >
                {demo.description}
              </p>
              <div
                style={{
                  color: "#bfdbfe",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Open demo
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
