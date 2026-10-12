import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  outputDir: "./test-results/live-browser",
  fullyParallel: false,
  workers: 1,
  timeout: 720000,
  expect: { timeout: 60000 },
  use: { baseURL: "http://localhost:3100", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
