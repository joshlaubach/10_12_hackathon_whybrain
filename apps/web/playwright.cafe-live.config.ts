import { defineConfig } from "@playwright/test";

// Separate app/process: never reuse or restart the PEP demo server on :3100.
export default defineConfig({
  testDir: "./tests/cafe-live",
  outputDir: "./test-results/cafe-live",
  workers: 1,
  timeout: 600000,
  expect: { timeout: 65000 },
  use: { baseURL: "http://localhost:3000", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3000",
    url: "http://localhost:3000", reuseExistingServer: false, timeout: 60000,
    env: { NEXT_PUBLIC_API_URL: "http://localhost:8002" },
  },
});
