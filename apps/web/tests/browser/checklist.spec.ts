import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import type { Schema } from "../../src/lib/contracts";

const fixture = (name: string) => JSON.parse(readFileSync(`../../packages/contracts/fixtures/${name}.json`, "utf8"));
const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const askEvents = () => fixture("stream_ask_386_440") as Schema<"StreamEvent">[];
const sse = (events: Schema<"StreamEvent">[]) => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
async function mock(page: Page) {
  await page.goto("/");
  if (await page.getByLabel("Data source").inputValue() !== "mock") await page.getByLabel("Data source").selectOption("mock");
  await expect(page.locator(".library-heading")).toContainText(String(fixture("decisions").documents.length));
}
async function review(page: Page) {
  await mock(page);
  await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
  await page.getByRole("button", { name: "Review proposal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
}

for (const [name, change] of [
  ["sequence gap", (e: Schema<"StreamEvent">[]) => { e[2].seq += 10; }],
  ["out of order", (e: Schema<"StreamEvent">[]) => { e[2].seq = 0; }],
  ["request ID changed", (e: Schema<"StreamEvent">[]) => { e[2].request_id = "other"; }],
  ["two terminals", (e: Schema<"StreamEvent">[]) => { e.push({ ...e.at(-1)!, seq: e.length }); }],
  ["missing terminal", (e: Schema<"StreamEvent">[]) => { e.pop(); }],
] as const) {
  test(`protocol ${name} produces a visible stream_interrupted error and stops`, async ({ page }) => {
    await mock(page);
    const events = askEvents(); change(events);
    await page.route("**/api/mock/ask", route => route.fulfill({ contentType: "text/event-stream", body: sse(events) }));
    await page.getByRole("button", { name: "Ask why", exact: true }).click();
    await expect(page.getByRole("alert", { name: "stream_interrupted error" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask why", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cancel request" })).not.toBeVisible();
    await expect(page.locator(".answer-panel")).not.toBeVisible();
  });
}
for (const code of ["model_unavailable", "not_found", "non-SSE"] as const) {
  test(`${code} before streaming renders a structured error`, async ({ page }) => {
    await mock(page);
    await page.route("**/api/mock/ask", route => code === "non-SSE" ? route.fulfill({ json: {} }) : route.fulfill({ status: code === "not_found" ? 404 : 503, json: { code, message: `Recorded ${code}`, request_id: "failure", retryable: false } }));
    await page.getByRole("button", { name: "Ask why", exact: true }).click();
    await expect(page.getByRole("alert", { name: `${code === "non-SSE" ? "stream_interrupted" : code} error` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask why", exact: true })).toBeEnabled();
  });
}

test("Abort cancels the network fetch and clears progress and answer state", async ({ page }) => {
  await mock(page);
  const failed = page.waitForEvent("requestfailed", { predicate: r => r.url().endsWith("/api/mock/ask") });
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel request" }).click();
  expect((await failed).failure()?.errorText).toMatch(/ABORTED|cancelled/i);
  await expect(page.getByText("Request cancelled.", { exact: false })).toBeVisible();
  await expect(page.locator(".stream-progress")).not.toBeVisible();
  await expect(page.locator(".answer-panel")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Ask why", exact: true })).toBeEnabled();
});

test("health config never supplies response mode; graph edges never come from prose", async ({ page }) => {
  await page.route("**/api/mock/health", route => route.fulfill({ json: { ...fixture("health"), configured: { hydradb: false, anthropic: false } } }));
  await mock(page);
  const events = askEvents(); const terminal = events.at(-1)!;
  if (terminal.type !== "answer_completed") throw new Error("Expected answer fixture");
  terminal.evidence_edges = [];
  terminal.answer += " PEP 386 superseded by PEP 440. PEP 999 replaces PEP 440.";
  await page.route("**/api/mock/ask", route => route.fulfill({ contentType: "text/event-stream", body: sse(events) }));
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByText("Recorded LIVE", { exact: true })).toBeVisible();
  await expect(page.locator(".edge-row")).toHaveCount(0);
  await expect(page.locator(".graph-node")).toHaveCount(terminal.inspected_doc_ids.length);
  await expect(page.locator(".graph-node").filter({ hasText: "PEP 999" })).toHaveCount(0);
});

test("source history, explicit gaps, and inferred conflicts are separate, labeled groups", async ({ page }) => {
  await mock(page);
  const events = askEvents(); const terminal = events.at(-1)!;
  if (terminal.type !== "answer_completed") throw new Error("Expected answer fixture");
  const header = terminal.evidence_edges[0];
  terminal.evidence_edges.push({ ...header, edge_id: "inferred", relation: "potential_conflict", origin: "inferred" });
  terminal.evidence_edges.push({ ...header, edge_id: "gap", target_doc_id: "pep-0749", target_in_corpus: false });
  await page.route("**/api/mock/ask", route => route.fulfill({ contentType: "text/event-stream", body: sse(events) }));
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  for (const name of ["Source-header relationships", "Missing successors", "Inferred conflicts"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".graph-node").filter({ hasText: "PEP 749" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Explicit evidence gaps" })).toContainText("PEP 749");
  const conflict = page.locator(".edge-row.conflict").filter({ hasText: "Potential conflict (inferred)" });
  await expect(conflict).toBeVisible();
  expect(await conflict.evaluate(el => getComputedStyle(el).color)).toBe("rgb(149, 98, 24)");
  await expect(page.getByRole("group", { name: "Evidence graph documents" })).toContainText("Source status: Superseded");
  await expect(page.getByRole("group", { name: "Evidence graph documents" })).toContainText("Source status: Final");
});

for (const width of [1440, 390]) {
  test(`all stream and draft fixtures render without application console errors at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource:")) errors.push(m.text()); });
    await mock(page);
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
      const contrastFailures = await page.evaluate(() => {
        const luminance = (color: string) => {
          const v = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
          return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
        };
        return [...document.querySelectorAll("body *")].filter(el => el.getClientRects().length && [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).flatMap(el => {
          if (el.closest(":disabled")) return [];
          const style = getComputedStyle(el);
          let parent: Element | null = el;
          let background = "rgb(255, 255, 255)";
          while (parent) {
            const bg = getComputedStyle(parent).backgroundColor;
            if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { background = bg; break; }
            parent = parent.parentElement;
          }
          const [low, high] = [luminance(style.color), luminance(background)].sort((a, b) => a - b);
          const ratio = (high + .05) / (low + .05);
          return ratio < 4.5 ? [`${el.textContent?.slice(0, 50)}: ${style.color} on ${background} = ${ratio.toFixed(2)}`] : [];
        });
      });
      expect(contrastFailures).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${name}.png`), fullPage: true });
    };
    await page.getByRole("button", { name: "Supersession", exact: true }).click();
    await expect(page.locator(".answer-panel")).toBeVisible();
    await page.getByRole("group", { name: "Evidence graph documents" }).getByRole("button").filter({ hasText: "PEP 386" }).click();
    await expect(page.getByRole("blockquote").first()).toContainText(fixture("stream_ask_386_440").at(-1).citations[0].quote);
    await capture("answer-graph");
    await page.getByRole("button", { name: "1 PEP 386 Header" }).click();
    await expect(page.getByRole("blockquote")).toContainText("Superseded-By: 440");
    // DecisionDetail fixture comes through the actual mock route.
    const detail = await page.request.get("/api/mock/decisions/pep-0386");
    expect(await detail.json()).toEqual(fixture("decision_pep-0386"));
    expect(await (await page.request.get("/api/mock/decisions")).json()).toEqual(fixture("decisions"));
    expect(await (await page.request.get("/api/mock/health")).json()).toEqual(fixture("health"));
    await page.getByRole("button", { name: "Missing successor", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Missing successors", exact: true })).toBeVisible();
    await expect(page.locator(".graph-node").filter({ hasText: "PEP 749" })).toHaveCount(0);
    await capture("gap");
    await page.getByRole("button", { name: "Unsupported question", exact: true }).click();
    await expect(page.getByRole("heading", { name: "I can't answer that from the record" })).toBeVisible();
    await expect(page.locator(".citation-button")).toHaveCount(0);
    await capture("abstention");
    await page.getByRole("button", { name: "Error example", exact: true }).click();
    await expect(page.getByRole("alert", { name: "model_unavailable error" })).toBeVisible();
    await capture("stream-error");
    await page.getByRole("button", { name: "Review Proposal", exact: true }).click();
    await page.getByRole("button", { name: "Review proposal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Working draft" })).toBeVisible();
    await expect(page.getByText("Suggested replacement (not an accepted change)", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recorded contacts", exact: true }).first()).toBeVisible();
    await expect(page.locator(".draft-editor")).toContainText("PROPOSAL");
    await capture("proposal-review");
    let state = "draft_pending";
    let httpStatus = 201;
    const ids: string[] = [];
    await page.route("**/api/mock/drafts**", async route => {
      const req = route.request();
      const id = req.method() === "POST" ? req.postDataJSON().draft_id : new URL(req.url()).pathname.split("/").at(-1);
      if (req.method() === "POST") ids.push(id);
      await route.fulfill({ status: state === "draft_conflict" ? 409 : req.method() === "POST" ? httpStatus : 200, json: state === "draft_conflict" ? fixture(state) : { ...fixture(state), draft_id: id } });
    });
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".draft-state")).toContainText("pending");
    await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving / verifying…" })).toBeDisabled();
    await capture("draft-pending");
    state = "draft_indexed";
    await expect(page.locator(".draft-state")).toContainText("Verified via: HydraDB (simulated)");
    await capture("draft-indexed");
    httpStatus = 200; state = "draft_indexed_local";
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".draft-state")).toContainText("Verified via: local store (simulated)");
    expect(ids[1]).toEqual(ids[0]);
    await capture("draft-indexed-local");
    state = "draft_conflict";
    await page.getByLabel("Draft text", { exact: true }).fill("Different draft content.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("alert", { name: "draft_conflict error" })).toContainText("save as a new draft");
    await capture("draft-conflict");
    state = "draft_failed"; httpStatus = 201;
    await page.getByRole("button", { name: "Save as new draft" }).click();
    await expect(page.locator(".draft-state")).toContainText("failed");
    expect(ids.at(-1)).not.toEqual(ids[0]);
    expect(ids.at(-1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await capture("draft-failed");
    expect(errors).toEqual([]);
  });
}

test("keyboard reaches citations, graph nodes, edges and Save with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page);
  await page.getByRole("button", { name: "Supersession", exact: true }).click();
  await expect(page.locator(".answer-panel")).toBeVisible();
  const reached = new Set<string>();
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press("Tab");
    const classes = await page.evaluate(() => document.activeElement?.className || "");
    for (const c of ["citation-button", "graph-node", "edge-row"]) if (classes.includes(c)) reached.add(c);
  }
  expect([...reached].sort()).toEqual(["citation-button", "edge-row", "graph-node"]);
  await review(page);
  let saveReached = false;
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("button", { name: "Save draft", exact: true }).evaluate(el => el === document.activeElement)) { saveReached = true; break; }
  }
  expect(saveReached).toBe(true);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});

test("configured API starts connected, uses only configured URL, and mock needs explicit selection", async ({ page }) => {
  // This test is run with NEXT_PUBLIC_API_URL=http://localhost:8001 during the final gate.
  expect(process.env.NEXT_PUBLIC_API_URL).toBeTruthy();
  const calls: string[] = [];
  await page.route(`${apiOrigin}/api/**`, route => {
    calls.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    return path.endsWith("/ask") ? route.fulfill({ contentType: "text/event-stream", body: sse(askEvents().map(e => ({ ...e, fixture: false }))) }) : route.fulfill({ json: fixture(path.endsWith("/health") ? "health" : "decisions") });
  });
  await page.goto("/");
  await expect(page.getByLabel("Data source")).toHaveValue("api");
  await expect(page.getByText("Mock data", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Awaiting response", { exact: true })).toBeVisible();
  await expect(page.locator(".library-heading")).toContainText("24");
  await page.getByRole("button", { name: "Ask why", exact: true }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  expect(calls.some(url => url.endsWith("/api/ask"))).toBe(true);
  expect(calls.every(url => url.startsWith(apiOrigin))).toBe(true);
  await page.getByLabel("Data source").selectOption("mock");
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
});

test("Save is disabled while the POST request itself is pending", async ({ page }) => {
  await review(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/mock/drafts", async route => {
    await held;
    await route.fulfill({ status: 201, json: { ...fixture("draft_indexed_local"), draft_id: route.request().postDataJSON().draft_id } });
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving / verifying…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
  await expect(page.getByLabel("Draft text", { exact: true })).toBeDisabled();
  release();
  await expect(page.locator(".draft-state")).toContainText("indexed");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
});
