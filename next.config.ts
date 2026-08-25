import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // TypeScript 7 (native Go compiler) ships no JS compiler API, so Next
    // invokes the `tsc` CLI directly for build-time type-checking instead.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
