import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import type { Schema, Terminal } from "../../src/lib/contracts";
import { cafeQuestions, cafeProposals } from "../../src/lib/corpus";
import { cafeHealth, cafeList, cafeAnswer, cafeGap, cafeSchedule, cafeAbstention, cafeReview, cafeDetail, refundQuote, sourceUrl, stream } from "../cafe-responses";

async function interceptCafe(page: Page, health = cafeHealth, list = cafeList) {
  const writes: { path: string; body: unknown }[] = [];
  let result: Terminal = cafeAnswer;
  await page.route(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"}/api/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (path === "/api/health") await route.fulfill({ headers, json: health });
    else if (path === "/api/decisions") await route.fulfill({ headers, json: list });
    else if (path === "/api/decisions/dr-018") await route.fulfill({ headers, json: cafeDetail });
    else if (path === "/api/ask" || path === "/api/proposals/review") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      const terminal = path.endsWith("/review") ? cafeReview : result;
      await route.fulfill({ headers, contentType: "text/event-stream", body: stream(terminal).map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
    } else await route.fulfill({ status: 404, headers });
  });
  return { writes, setResult: (value: Terminal) => { result = value; } };
}
async function noPep(page: Page) {
  expect(await page.locator("body").innerText()).not.toMatch(/PEP|Python/);
  for (const field of await page.locator("input, textarea").all()) expect(await field.inputValue()).not.toMatch(/PEP|Python/);
}
async function loadCafe(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Fictional sample: Maple Street Café", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Data source")).toHaveValue("api");
  await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
  await noPep(page);
}

for (const width of [1440, 390]) test(`café answer, examples, statuses, gap, abstention and review at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const api = await interceptCafe(page);
  await loadCafe(page);
  const strip = page.getByRole("region", { name: "Corpus statistics" });
  await expect(strip.locator("dd")).toHaveText([String(cafeList.documents.length), String(cafeHealth.corpus.source_header_edges), String(cafeHealth.corpus.missing_successors), cafeList.snapshot_id]);
  await expect(strip).toContainText(cafeList.snapshot_id);
  await expect(page.locator(".workspace-name")).toContainText("Maple Street Café");
  for (const doc of cafeList.documents) {
    const card = page.locator(".decision-card").filter({ hasText: doc.title });
    await expect(card.locator(".decision-status")).toHaveText(`Source status: ${doc.source_status}`);
  }
  const scheduleCard = page.locator(".decision-card").filter({ hasText: "Weekly schedule on paper" });
  await expect(scheduleCard.locator(".decision-status")).toHaveText("Source status: Accepted");
  await expect(scheduleCard.locator(".decision-relation")).toHaveText("Superseded by DR-018");
  for (const question of cafeQuestions) {
    await page.getByRole("button", { name: question, exact: true }).click();
    await expect(page.getByLabel("Ask a question", { exact: true })).toHaveValue(question);
  }
  expect(api.writes).toHaveLength(0);
  await page.getByRole("button", { name: cafeQuestions[0], exact: true }).click();
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  expect(api.writes[0].body).toEqual({ question: cafeQuestions[0], mode_preference: "AUTO" });
  await expect(page.locator(".graph-node")).toHaveCount(2);
  await expect(page.locator(".edge-row")).toHaveCount(cafeAnswer.evidence_edges.length);
  await page.getByRole("button", { name: "2 DR-014 Decision", exact: true }).click();
  await expect(page.getByRole("blockquote")).toHaveText(refundQuote);
  await expect(page.locator(".evidence-inspector a")).toHaveAttribute("href", sourceUrl("dr-014"));
  await page.getByRole("button", { name: "DR-002 Superseded by DR-014", exact: true }).click();
  await expect(page.getByRole("blockquote")).toHaveText("Superseded-By: DR-014");
  await noPep(page);
  await page.screenshot({ path: testInfo.outputPath("cafe-answer.png"), fullPage: true });

  api.setResult(cafeGap);
  await page.getByRole("button", { name: cafeQuestions[1], exact: true }).click();
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Missing successors", exact: true })).toBeVisible();
  await expect(page.locator(".graph-node")).toHaveCount(2);
  await expect(page.locator(".graph-node").filter({ hasText: "DR-021" })).toHaveCount(0);
  await page.getByRole("button", { name: "DR-021 Missing from corpus Explicit evidence gap", exact: true }).click();
  await expect(page.locator(".evidence-inspector")).toContainText("This successor is missing from the corpus snapshot.");
  await noPep(page);
  await page.screenshot({ path: testInfo.outputPath("cafe-gap.png"), fullPage: true });

  api.setResult(cafeSchedule);
  await page.getByLabel("Ask a question", { exact: true }).fill("Why did we stop using paper schedules?");
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByRole("button", { name: "DR-009 Superseded by DR-018", exact: true })).toBeVisible();
  await expect(page.locator(".graph-node").filter({ hasText: "DR-009" })).toContainText("Source status: Accepted");
  const successor = page.locator(".graph-node").filter({ hasText: "DR-018" });
  await successor.click();
  await expect(page.locator(".evidence-inspector .source-text")).toContainText("shift swaps are agreed there too");
  await noPep(page);
  await page.screenshot({ path: testInfo.outputPath("cafe-accepted-superseded.png"), fullPage: true });

  api.setResult(cafeAbstention);
  await page.getByRole("button", { name: cafeQuestions[2], exact: true }).click();
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByRole("heading", { name: "I can't answer that from the record", exact: true })).toBeVisible();
  await expect(page.locator(".citation-button")).toHaveCount(0);
  await noPep(page);
  await page.screenshot({ path: testInfo.outputPath("cafe-abstention.png"), fullPage: true });

  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  const before = api.writes.length;
  for (const proposal of cafeProposals) {
    await page.getByRole("button", { name: proposal, exact: true }).click();
    await expect(page.getByLabel("Proposed change", { exact: true })).toHaveValue(proposal);
  }
  expect(api.writes).toHaveLength(before);
  await page.getByRole("button", { name: cafeProposals[0], exact: true }).click();
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
  await expect(page.getByText("Suggested replacement (not an accepted change)", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Recorded contacts", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Fictional sample: Maple Street Café", { exact: true })).toBeVisible();
  expect(api.writes.at(-1)?.body).toEqual({ proposal_text: cafeProposals[0], mode_preference: "AUTO" });
  await noPep(page);
  await page.screenshot({ path: testInfo.outputPath("cafe-review.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Evaluation", exact: true }).click();
  await expect(page.getByText("Fictional sample: Maple Street Café", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "not run yet", exact: true })).toBeVisible();
  await noPep(page);
  expect(errors).toEqual([]);
});

test("document-prefix detection, café empty search, and explicit PEP-only mock switch", async ({ page }) => {
  await interceptCafe(page, { ...cafeHealth, snapshot_id: "unclassified-snapshot" });
  await loadCafe(page);
  await page.getByLabel("Filter decisions").fill("not-a-decision");
  await expect(page.getByText("No matching decisions. Try a title, decision ID, or source status.")).toBeVisible();
  await noPep(page);
  await page.getByLabel("Data source").selectOption("mock");
  await expect(page.locator(".workspace-name")).toContainText("Python decisions");
  await expect(page.getByText("Fictional sample: Maple Street Café", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Supersession", exact: true }).click();
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded LIVE", { exact: true })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/Café|Fictional sample/);
});

test("PEP connected text and examples stay unchanged; Final PEP 333 can be superseded", async ({ page }) => {
  const fixture = (name: string) => JSON.parse(readFileSync(`../../packages/contracts/fixtures/${name}.json`, "utf8"));
  await page.route(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"}/api/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (path === "/api/health" || path === "/api/decisions") await route.fulfill({ headers, json: fixture(path.endsWith("health") ? "health" : "decisions") });
    else if (path === "/api/ask") await route.fulfill({ headers, contentType: "text/event-stream", body: (fixture("stream_ask_386_440") as Schema<"StreamEvent">[]).map(event => `data: ${JSON.stringify({ ...event, fixture: false })}\n\n`).join("") });
    else await route.fulfill({ status: 404, headers });
  });
  await page.goto("/");
  await expect(page.locator(".library-heading")).toContainText("24");
  await expect(page.locator(".workspace-name")).toHaveText("PyPython decisionsPublic PEP corpus");
  await expect(page.getByLabel("Ask a question", { exact: true })).toHaveValue("Why was PEP 386 replaced by PEP 440?");
  const card = page.locator(".decision-card").filter({ has: page.getByText("PEP 333", { exact: true }) });
  await expect(card.locator(".decision-status")).toHaveText("Source status: Final");
  await expect(card.locator(".decision-relation")).toHaveText("Superseded by PEP 3333");
  await page.getByRole("button", { name: "Supersession", exact: true }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(page.locator(".citation-button")).toHaveCount(6);
  await expect(page.locator(".graph-node")).toHaveCount(2);
  await expect(page.locator(".workspace-footer")).toContainText("Python Enhancement Proposals");
  expect(await page.locator("body").innerText()).not.toMatch(/Café|Fictional sample/);
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  await expect(page.getByLabel("Proposed change", { exact: true })).toHaveValue("Sort development releases between the last release candidate and the final release, so that dev builds sort after rc builds.");
  await expect(page.getByText("Try a proposal", { exact: true })).not.toBeVisible();
});

test("health-only café detection keeps an empty corpus free of PEP labels", async ({ page }) => {
  await interceptCafe(page, { ...cafeHealth, corpus: { documents: 0, source_header_edges: 0, missing_successors: 0 } }, { ...cafeList, documents: [] });
  await loadCafe(page);
  await expect(page.locator(".decision-card")).toHaveCount(0);
  await expect(page.getByText("No matching decisions. Try a title, decision ID, or source status.")).toBeVisible();
  await noPep(page);
});
