import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Schema } from "../../src/lib/contracts";

const fixtures = (name: string) => JSON.parse(readFileSync(`../../packages/contracts/fixtures/${name}.json`, "utf8"));

test("connected API uses response provenance and detects interrupted streams without falling back", async ({ page }) => {
  let replay = false;
  let interrupted = false;
  await page.route("http://localhost:8000/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (path.endsWith("/health") || path.endsWith("/decisions")) {
      await route.fulfill({ headers, json: fixtures(path.endsWith("/health") ? "health" : "decisions") });
    } else if (path.endsWith("/ask")) {
      const request = route.request().postDataJSON() as Schema<"AskRequest">;
      replay = request.mode_preference === "REPLAY";
      const events = (fixtures("stream_ask_386_440") as Schema<"StreamEvent">[]).map(e => ({ ...e, fixture: replay }));
      const body = (interrupted ? events.slice(0, -1) : events).map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      await route.fulfill({ headers, contentType: "text/event-stream", body });
    } else await route.fulfill({ status: 404, headers });
  });
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("api");
  await expect(page.locator(".library-heading")).toContainText("24");
  await expect(page.getByText("Awaiting response", { exact: true })).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
  await page.getByLabel("Ask a question", { exact: true }).fill("An API question that isn't a fixture selector.");
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
  interrupted = true;
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByRole("alert", { name: "stream_interrupted error" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the evidence says" })).not.toBeVisible();
  interrupted = false;
  await page.getByLabel("Data source").selectOption("replay");
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded LIVE", { exact: true })).toBeVisible();
  expect(replay).toBe(true);
});
