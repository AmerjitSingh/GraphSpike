import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      // `include` reports on every matching file whether or not a test imported
      // it, so the number reflects real coverage of the active library rather
      // than only-what-was-imported.
      include: ["graph-canvas/**/*.{ts,tsx}"],
      exclude: [
        "graph-canvas/**/__tests__/**",
        "graph-canvas/index.ts",
        "**/*.d.ts",
      ],
      reporter: ["text-summary", "html"],
      // Set a few points below the measured result so an unrelated refactor
      // doesn't red the build, while a real regression still fails CI.
      thresholds: {
        statements: 87,
        lines: 90,
        functions: 88,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      // Tests must exercise the library SOURCE, not the built dist: dist is
      // gitignored (absent in CI, stale locally after edits), and coverage is
      // measured against source files. Without this, "@/graph-canvas" resolves
      // through the package's `main` to dist/index.js. Listed before the "@"
      // catch-all — aliases match in insertion order.
      "@/graph-canvas": `${import.meta.dirname}/graph-canvas/index.ts`,
      "@": import.meta.dirname,
    },
  },
});
