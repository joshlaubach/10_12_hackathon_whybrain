import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(process.cwd(), "../..");
const config: NextConfig = {
  devIndicators: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    "/api/mock/*": ["../../packages/contracts/fixtures/**/*.json", "../../data/peps/*.rst"],
    "/": ["../../packages/contracts/fixtures/*.json", "../../data/peps/manifest.json"],
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
};
export default config;
