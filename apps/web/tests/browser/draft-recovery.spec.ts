import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Schema } from "../../src/lib/contracts";

test("a long pending draft can resume verification after the UI timeout", async ({ page }) => {
  const fixture = (name: string) => JSON.parse(readFileSync(`../../packages/contracts/fixtures/${name}.json`, "utf8")) as Schema<"DraftRecord">;
  let id = "";
  let resume = false;
  await page.route("**/api/mock/drafts**", async route => {
    if (route.request().method() === "POST") {
      id = (route.request().postDataJSON() as Schema<"DraftCreateRequest">).draft_id;
      await route.fulfill({ status: 201, json: { ...fixture("draft_pending"), draft_id: id } });
    } else if (resume) {
      await route.fulfill({ json: { ...fixture("draft_indexed"), draft_id: id } });
    } else {
      // Hold the read until the client aborts its bounded verification window.
      await new Promise(resolve => route.request().frame().page().once("requestfailed", resolve));
    }
  });
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("mock");
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-state")).toContainText("pending");
  await page.clock.fastForward(1000);
  await page.clock.fastForward(60000);
  await expect(page.getByRole("alert", { name: "timeout error" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check draft status", exact: true })).toBeEnabled();
  resume = true;
  await page.getByRole("button", { name: "Check draft status", exact: true }).click();
  await expect(page.locator(".draft-state")).toContainText("indexed");
  await expect(page.locator(".draft-state")).toContainText("Verified via: HydraDB");
  await expect(page.locator(".draft-id")).toContainText(id);
  await expect(page.getByRole("alert", { name: "timeout error" })).not.toBeVisible();
});
