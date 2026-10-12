import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Schema } from "../../src/lib/contracts";
import { consumeSSE } from "../../src/lib/sse";
import { scenarios } from "../../src/lib/scenarios";

const api = "http://localhost:8000";
async function screenshots(page: Page, info: TestInfo, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("real API: provenance, source citations, graph, gap, abstention and review", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const payloads: Schema<"StreamEvent">[] = [];
  async function terminal(path: string, expected: "answer_completed" | "review_completed", click: () => Promise<void>) {
    const pending = page.waitForResponse(response => response.url() === `${api}/api/${path}` && response.request().method() === "POST");
    await click();
    const response = await pending;
    expect(response.status()).toBe(200);
    const body = await response.body();
    const result = await consumeSSE(new Response(body.toString("utf8"), { headers: { "Content-Type": response.headers()["content-type"] } }), event => payloads.push(event), AbortSignal.timeout(10000), expected);
    expect(result.type).toBe(expected);
    if (result.type === "error") throw new Error(`${result.code}: ${result.message}`);
    await info.attach(`${path.replaceAll("/", "-")}-${result.request_id}`, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    expect(result.fixture).toBe(false);
    await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
    await expect(page.locator(".mode-indicator")).toHaveText(result.provenance.mode_used);
    const missing = new Set(result.evidence_edges.filter(edge => !edge.target_in_corpus).map(edge => edge.target_doc_id));
    const nodes = new Set([...result.inspected_doc_ids, ...result.evidence_edges.flatMap(edge => edge.target_in_corpus ? [edge.source_doc_id, edge.target_doc_id] : [edge.source_doc_id])].filter(id => !missing.has(id)));
    await expect(page.locator(".graph-node:visible")).toHaveCount(nodes.size);
    await expect(page.locator(".edge-row:visible")).toHaveCount(result.evidence_edges.length);
    return result;
  }
  async function ask(index: number) {
    await page.getByLabel("Ask a question", { exact: true }).fill(scenarios[index].question);
    return terminal("ask", "answer_completed", () => page.getByRole("button", { name: "Ask why", exact: true }).click());
  }
  await page.goto("/");
  await expect(page.getByLabel("Data source")).toHaveValue("api");
  await expect(page.locator(".library-heading")).toContainText("24");
  const answer = await ask(0);
  expect(answer.provenance.mode_used).toBe("LIVE");
  if (answer.type !== "answer_completed") throw new Error("Expected answer");
  expect.soft(answer.citations.length).toBeGreaterThanOrEqual(3);
  expect.soft([...answer.citations, ...answer.evidence_edges.filter(e => e.origin === "source_header").flatMap(e => e.supporting_evidence)].some(c => c.doc_id === "pep-0386" && c.locator.toLowerCase() === "header" && /Superseded-By:\s*440/.test(c.quote)), "PEP 386 source-header quote").toBe(true);
  expect.soft(answer.citations.some(c => c.doc_id === "pep-0440" && c.quote.trim()), "PEP 440 citation").toBe(true);
  await expect(page.locator(".citation-button")).toHaveCount(answer.citations.length);
  await page.locator(".citation-button").first().click();
  await expect(page.locator(".evidence-inspector blockquote")).toHaveText(answer.citations[0].quote);
  await screenshots(page, info, "386-answer");
  const gap = await ask(1);
  expect(gap.evidence_edges.some(edge => edge.target_doc_id === "pep-0749" && !edge.target_in_corpus)).toBe(true);
  await expect(page.locator(".evidence-gap")).toContainText("PEP 749");
  await expect(page.locator(".graph-node").filter({ hasText: "PEP 749" })).toHaveCount(0);
  await screenshots(page, info, "563-gap");
  const abstention = await ask(2);
  if (abstention.type !== "answer_completed") throw new Error("Expected answer");
  expect(abstention.abstained).toBe(true); expect(abstention.citations).toHaveLength(0);
  await expect(page.getByRole("heading", { name: "I can't answer that from the record" })).toBeVisible();
  await screenshots(page, info, "abstention");
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  const review = await terminal("proposals/review", "review_completed", () => page.getByRole("button", { name: "Review proposal", exact: true }).click());
  if (review.type !== "review_completed") throw new Error("Expected review");
  expect(review.findings.length).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
  await expect(page.locator(".findings-panel")).toContainText("Recorded contacts");
  await screenshots(page, info, "proposal-review");
  // Live draft indexing is under investigation. Do not POST drafts until Josh authorizes it.
  await writeFile(info.outputPath("responses.json"), JSON.stringify({ events: payloads, draft_indexing: "deferred" }, null, 2));
  expect(errors).toEqual([]);
});
