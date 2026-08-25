import Link from "next/link";
import { PreviewPhaseDemo } from "@/app/demos/preview-phase";

export default function PreviewPhasePage() {
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
            Preview Phase
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              color: "#94a3b8",
              lineHeight: 1.7,
            }}
          >
            The drag preview resolves as an S-curve; the edge it becomes resolves
            as straight. Both come from <code>getEdgeRoute</code>, which receives{" "}
            <code>phase</code>.
          </p>
        </div>

        <PreviewPhaseDemo />
      </div>
    </main>
  );
}
