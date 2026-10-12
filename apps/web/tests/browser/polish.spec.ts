import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Schema } from "../../src/lib/contracts";

test("header statistics follow corpus responses and card chips reflect present fields", async ({ page }) => {
  const list = JSON.parse(readFileSync("../../packages/contracts/fixtures/decisions.json", "utf8")) as Schema<"DecisionList">;
  const health = JSON.parse(readFileSync("../../packages/contracts/fixtures/health.json", "utf8")) as Schema<"HealthResponse">;
  const documents = list.documents.slice(0, 2).map(doc => ({ ...doc, authors: [], replaces: [], resolution_url: null, discussions_to: null }));
  const snapshot = "response-driven-snapshot";
  await page.route("**/api/mock/decisions", route => route.fulfill({ json: { documents, snapshot_id: snapshot } }));
  await page.route("**/api/mock/health", route => route.fulfill({ json: { ...health, snapshot_id: snapshot, corpus: { documents: documents.length, source_header_edges: 31, missing_successors: 7 } } }));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("mock");
  const strip = page.getByRole("region", { name: "Corpus statistics" });
  await expect(strip).toContainText(snapshot);
  await expect(strip.locator("dd")).toHaveText([String(documents.length), "31", "7", snapshot]);
  await expect(page.locator(".decision-chip")).toHaveCount(0);
  const badge = page.getByText("Mock data", { exact: true });
  await expect(badge).toHaveCSS("color", "rgb(32, 33, 31)");
  await expect(badge).toHaveCSS("border-top-color", "rgb(32, 33, 31)");
  expect(await page.locator("body").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Inter");
});
