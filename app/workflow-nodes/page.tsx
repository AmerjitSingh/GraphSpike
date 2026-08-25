import Link from "next/link";
import { WorkflowNodesDemo } from "@/app/demos/workflow-nodes";

export default function WorkflowNodesPage() {
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

        <div style={{ maxWidth: 720, marginBottom: 26 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(2.2rem, 5vw, 3.6rem)" }}>
            Workflow Nodes
          </h1>
          <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
            Agent nodes with typed ports — chat model, memory, tool, output parser
            — declared as data through{" "}
            <code style={{ color: "#93c5fd", fontSize: "0.9em" }}>getNodePorts</code>.
          </p>
          <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
            Drag a{" "}
            <code style={{ color: "#93c5fd", fontSize: "0.9em" }}>model</code> port at
            a <code style={{ color: "#93c5fd", fontSize: "0.9em" }}>tool</code> slot
            and the preview turns red: types must match. Model, memory, and parser
            ports stop accepting edges once they reach their{" "}
            <code style={{ color: "#93c5fd", fontSize: "0.9em" }}>maxConnections</code>.
            Tool ports accept multiple compatible tools.
          </p>
        </div>

        <WorkflowNodesDemo />
      </div>
    </main>
  );
}
