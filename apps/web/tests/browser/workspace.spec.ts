import { test, expect } from "@playwright/test";

test("initial workspace, citations, source metadata, and snapshot counts", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Why did we decide that?" })).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded LIVE", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "1 PEP 386 Header" }).click();
  await expect(page.getByRole("blockquote")).toContainText("Superseded-By: 440");
  await page.getByRole("button", { name: "PEP 386 Superseded by PEP 440", exact: true }).click();
  await expect(page.getByRole("blockquote")).toContainText("Superseded-By: 440");
  await page.getByRole("button", { name: "Evaluation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "not run yet" })).toBeVisible();
  await expect(page.locator(".corpus-counts")).toContainText("24");
  await expect(page.locator(".corpus-counts")).toContainText("17");
  expect(errors).toEqual([]);
});

test("uncited graph nodes load source sections once and reuse the detail cache", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/mock/decisions/pep-0621", async route => { reads++; await route.continue(); });
  await page.goto("/");
  await page.getByRole("button", { name: "Unsupported question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence is insufficient" })).toBeVisible();
  const node = page.getByRole("group", { name: "Evidence graph documents" }).getByRole("button", { name: "PEP 621 Storing project metadata in pyproject.toml Source status: Final", exact: true });
  await node.click();
  await expect(page.getByLabel("Source section", { exact: true })).toBeVisible();
  await page.getByLabel("Source section", { exact: true }).selectOption({ label: "Abstract" });
  await expect(page.locator(".evidence-inspector .source-text")).not.toBeEmpty();
  await node.click();
  await expect(page.getByLabel("Source section", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
});

test("mock SSE exposes missing successors and supports cancellation and errors", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Missing successor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ask why", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Missing successors", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "PEP 749 Missing from corpus Explicit evidence gap", exact: true }).click();
  await expect(page.getByText("This successor is missing from the corpus snapshot.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Unsupported question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence is insufficient" })).toBeVisible();
  await page.getByRole("button", { name: "Supersession", exact: true }).click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  await expect(page.getByText("Request cancelled.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Error example", exact: true }).click();
  await expect(page.getByRole("alert", { name: "model_unavailable error" })).toBeVisible();
});

test("proposal save, immutable ID conflict, new draft, and failed indexing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
  await expect(page.getByText("Suggested replacement (not an accepted change)", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-state")).toContainText("pending");
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
  await expect(page.locator(".draft-state")).toContainText("indexed");
  const firstId = await page.locator(".draft-id").innerText();
  await page.getByRole("button", { name: "Ask Why", exact: true }).click();
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  expect(await page.locator(".draft-id").innerText()).toEqual(firstId);
  await page.getByLabel("Draft text", { exact: true }).fill("Changed proposal with new evidence.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert", { name: "draft_conflict error" })).toBeVisible();
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.locator(".draft-state")).toContainText("indexed");
  expect(await page.locator(".draft-id").innerText()).not.toEqual(firstId);
  await page.getByLabel("Mock save scenario").selectOption("failed");
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.locator(".draft-state")).toContainText("failed");
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
});

test("mobile layout stays within the viewport and navigation works", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Evaluation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "not run yet" })).toBeVisible();
});
