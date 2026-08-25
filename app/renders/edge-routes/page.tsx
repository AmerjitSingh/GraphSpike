import Link from "next/link";
import { EdgeRoutesDemo } from "@/app/demos/edge-routes";

export default function EdgeRoutesPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 24px",
        background:
          "radial-gradient(circle at top left, #12305a 0%, #081226 42%, #030712 100%)",
        color: "#e2e8f0",
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: 22,
            color: "#93c5fd",
            textDecoration: "none",
          }}
        >
          Back to demo list
        </Link>

        <div style={{ maxWidth: 760, marginBottom: 26 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>
            Edge Route Types
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              color: "#94a3b8",
              lineHeight: 1.7,
            }}
          >
            Four routes set per edge with <code>getEdgeRoute</code>: curved,
            S-curved, straight and angled. The curved ones exaggerate the bend
            through <code>getEdgeCurveStrength</code> and{" "}
            <code>getEdgeControlPoints</code>.
          </p>
        </div>

        <EdgeRoutesDemo />
      </div>
    </main>
  );
}
