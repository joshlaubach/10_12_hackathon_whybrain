import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Schema, Terminal } from "../../src/lib/contracts";
import { consumeSSE } from "../../src/lib/sse";
import { docLabel, findingLabel, relationLabel } from "../../src/lib/contracts";
import { cafeQuestions, cafeProposals } from "../../src/lib/corpus";
import { validateHealth, validateList } from "../../src/lib/validation";

const api = "http://localhost:8002";
async function screenshots(page: Page, info: TestInfo, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("real café API: refund, hours gap, loyalty abstention, Accepted schedule and model-driven review; no draft saves", async ({ page }, info) => {
  const errors: string[] = [];
  const responses: Terminal[] = [];
  let draftAttempts = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  // Only write endpoints are blocked. Every health/list/ask/review response is real.
  await page.route(`${api}/api/drafts**`, route => { draftAttempts++; return route.abort(); });
  const healthPending = page.waitForResponse(`${api}/api/health`);
  const listPending = page.waitForResponse(`${api}/api/decisions`);
  await page.goto("/");
  const health = await (await healthPending).json() as Schema<"HealthResponse">;
  const list = await (await listPending).json() as Schema<"DecisionList">;
  expect(validateHealth(health)).toBe(true);
  expect(validateList(list)).toBe(true);
  expect(health.snapshot_id).toBe("cafe-5ed395beac31");
  await expect(page.getByText("Fictional sample: Maple Street Café", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Data source")).toHaveValue("api");
  await expect(page.getByLabel("Data source").locator('option[value="replay"]')).toHaveCount(0);
  await expect(page.getByText("Replay recordings are unavailable for this corpus.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Corpus statistics" }).locator("dd")).toHaveText([String(list.documents.length), String(health.corpus.source_header_edges), String(health.corpus.missing_successors), list.snapshot_id]);

  async function run(path: string, expected: "answer_completed" | "review_completed", click: () => Promise<void>) {
    const pending = page.waitForResponse(response => response.url() === `${api}/api/${path}` && response.request().method() === "POST");
    await click();
    const response = await pending;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().mode_preference).toBe("AUTO");
    const result = await consumeSSE(new Response((await response.body()).toString("utf8"), { headers: { "Content-Type": response.headers()["content-type"] } }), () => {}, AbortSignal.timeout(10000), expected);
    if (result.type === "error") throw new Error(`${result.code}: ${result.message}`);
    responses.push(result);
    await info.attach(`${path.replaceAll("/", "-")}-${result.request_id}`, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    expect(result.fixture).toBe(false);
    await expect(page.locator(".mode-indicator")).toHaveText(result.provenance.mode_used);
    await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
    await expect(page.locator(".error-notice")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/PEP/);
    const missing = new Set(result.evidence_edges.filter(edge => !edge.target_in_corpus).map(edge => edge.target_doc_id));
    const nodes = [...new Set([...result.inspected_doc_ids, ...result.evidence_edges.flatMap(edge => edge.target_in_corpus ? [edge.source_doc_id, edge.target_doc_id] : [edge.source_doc_id])])].filter(id => !missing.has(id));
    await expect(page.locator(".graph-node:visible .node-id")).toHaveText(nodes.map(docLabel));
    await expect(page.locator(".edge-row:visible")).toHaveCount(result.evidence_edges.length);
    for (const edge of result.evidence_edges) await expect(page.getByRole("button", { name: `${docLabel(edge.source_doc_id)} ${relationLabel[edge.relation]} ${docLabel(edge.target_doc_id)}${edge.target_in_corpus ? "" : " Missing from corpus"}`, exact: true }).first()).toBeVisible();
    if (result.type === "answer_completed") await expect(page.locator(".answer-copy")).toHaveText(result.abstained ? result.abstain_reason ?? "" : result.answer ?? "");
    return result;
  }
  async function ask(question: string) {
    await page.getByLabel("Ask a question", { exact: true }).fill(question);
    const result = await run("ask", "answer_completed", () => page.getByRole("button", { name: "Ask why", exact: true }).click());
    if (result.type !== "answer_completed") throw new Error("Expected answer");
    return result;
  }
  const refund = await ask(cafeQuestions[0]);
  expect.soft(refund.citations.some(c => c.doc_id === "dr-014"), "refund cites DR-014").toBe(true);
  expect.soft(refund.evidence_edges.some(e => e.source_doc_id === "dr-002" && e.target_doc_id === "dr-014" && e.relation === "superseded_by")).toBe(true);
  expect.soft(refund.evidence_edges.some(e => e.source_doc_id === "dr-014" && e.target_doc_id === "dr-002" && e.relation === "replaces")).toBe(true);
  await expect(page.locator(".decision-card").filter({ has: page.getByText("DR-002", { exact: true }) }).locator(".decision-status")).toHaveText("Source status: Superseded");
  const index = refund.citations.findIndex(c => c.doc_id === "dr-014");
  if (index >= 0) {
    await page.locator(".citation-button").nth(index).click();
    await expect(page.getByRole("link", { name: "Read source file", exact: true })).toHaveAttribute("href", refund.citations[index].source_url);
    expect(new URL(refund.citations[index].source_url).hostname).toBe("github.com");
  }
  await screenshots(page, info, "refund");

  const hours = await ask(cafeQuestions[1]);
  expect.soft(hours.evidence_edges.some(e => e.source_doc_id === "dr-005" && e.target_doc_id === "dr-016" && e.relation === "superseded_by")).toBe(true);
  expect.soft(hours.evidence_edges.some(e => e.target_doc_id === "dr-021" && !e.target_in_corpus)).toBe(true);
  await expect(page.locator(".evidence-gap")).toContainText("DR-021");
  await expect(page.locator(".graph-node").filter({ has: page.getByText("DR-021", { exact: true }) })).toHaveCount(0);
  await screenshots(page, info, "hours-gap");

  const loyalty = await ask(cafeQuestions[2]);
  expect.soft(loyalty.abstained, "current loyalty ownership abstains").toBe(true);
  expect.soft(loyalty.citations).toHaveLength(0);
  await expect(page.getByRole("heading", { name: "I can't answer that from the record", exact: true })).toBeVisible();
  await page.locator(".decision-card").filter({ has: page.getByText("DR-011", { exact: true }) }).click();
  await expect(page.locator(".decision-detail")).toContainText("Recorded contacts");
  await expect(page.locator(".decision-detail")).toContainText("Priya Nair");
  await screenshots(page, info, "loyalty-abstention");

  const schedule = await ask("Why did we stop using paper schedules? Explain DR-009 and DR-018.");
  expect.soft(schedule.evidence_edges.some(e => e.source_doc_id === "dr-009" && e.target_doc_id === "dr-018" && e.relation === "superseded_by")).toBe(true);
  const scheduleCard = page.locator(".decision-card").filter({ has: page.getByText("DR-009", { exact: true }) });
  await expect(scheduleCard.locator(".decision-status")).toHaveText("Source status: Accepted");
  await expect(scheduleCard.locator(".decision-relation")).toHaveText("Superseded by DR-018");
  await expect(page.locator(".graph-node").filter({ has: page.getByText("DR-009", { exact: true }) })).toContainText("Source status: Accepted");
  await screenshots(page, info, "schedule-accepted-superseded");

  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  for (const [index, proposal] of cafeProposals.entries()) {
    await page.getByRole("button", { name: proposal, exact: true }).click();
    const review = await run("proposals/review", "review_completed", () => page.getByRole("button", { name: "Review proposal", exact: true }).click());
    if (review.type !== "review_completed") throw new Error("Expected review");
    await expect(page.locator(".finding-heading .state-label")).toHaveText(review.findings.map(finding => findingLabel[finding.relation]));
    await expect(page.getByLabel("Draft text", { exact: true })).toHaveValue(review.draft_md);
    for (const [index, finding] of review.findings.entries()) await expect(page.locator(".findings-panel .finding .source-link").nth(index)).toHaveAttribute("href", finding.source_url);
    await screenshots(page, info, `proposal-${index}`);
  }
  await writeFile(info.outputPath("responses.json"), JSON.stringify({ health, list, responses, draft_saves: "not attempted" }, null, 2));
  expect(draftAttempts).toBe(0);
  expect(errors).toEqual([]);
});
