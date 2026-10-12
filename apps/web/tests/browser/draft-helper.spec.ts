import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Schema } from "../../src/lib/contracts";

test("indexed drafts show static enrichment helper for either verified store without changing status or PROPOSAL", async ({ page }) => {
  const fixture = (name: string) => JSON.parse(readFileSync(`../../packages/contracts/fixtures/${name}.json`, "utf8")) as Schema<"DraftRecord">;
  const helper = page.getByText("searchable; graph enrichment may still be running", { exact: true });
  let state = "draft_pending";
  await page.route("**/api/mock/drafts**", async route => {
    const id = route.request().method() === "POST" ? (route.request().postDataJSON() as Schema<"DraftCreateRequest">).draft_id : new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({ json: { ...fixture(state), draft_id: id } });
  });
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("mock");
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Working draft", exact: true })).toBeVisible();
  await expect(helper).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-state > .section-heading .state-label")).toHaveText("pending");
  await expect(helper).toHaveCount(0);
  state = "draft_indexed";
  await expect(helper).toBeVisible();
  await expect(page.locator(".draft-state > .section-heading .state-label")).toHaveText("indexed");
  await expect(page.locator(".draft-state")).toContainText("Verified via: HydraDB (simulated)");
  await expect(page.locator(".draft-editor .proposal-label")).toHaveText("PROPOSAL");
  state = "draft_indexed_local";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-state")).toContainText("Verified via: local store (simulated)");
  await expect(helper).toBeVisible();
  await expect(page.locator(".draft-state > .section-heading .state-label")).toHaveText("indexed");
  await expect(page.locator(".draft-editor .proposal-label")).toHaveText("PROPOSAL");
  state = "draft_failed";
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-state > .section-heading .state-label")).toHaveText("failed");
  await expect(helper).toHaveCount(0);
});
