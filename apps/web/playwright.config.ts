import { defineConfig } from "@playwright/test";

// The browser gate exercises a configured API; application defaults stay explicit.
process.env.NEXT_PUBLIC_API_URL ||= "http://localhost:8001";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL: "http://localhost:3100", viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "npm run dev", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60000 },
});
