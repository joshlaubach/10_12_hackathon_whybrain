import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Schema } from "../src/lib/contracts";
import { consumeSSE, checkResponse } from "../src/lib/sse";
import { validateHealth, validateList, validateDetail } from "../src/lib/validation";
import { scenarios, exampleProposal } from "../src/lib/scenarios";

const base = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const results: Record<string, unknown> = { base, at: new Date().toISOString() };
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push(`${name}: ${message}`); console.error(`FAIL ${name}: ${message}`); }
}
async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${base}/api/${path}`, { ...init, signal: AbortSignal.timeout(15000) });
  await checkResponse(response);
  return { status: response.status, body: await response.json() as unknown };
}
async function stream(path: string, request: Schema<"AskRequest"> | Schema<"ProposalReviewRequest">, expected: "answer_completed" | "review_completed") {
  const signal = AbortSignal.timeout(180000);
  const response = await fetch(`${base}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(request), signal });
  const events: Schema<"StreamEvent">[] = [];
  const terminal = await consumeSSE(response, event => events.push(event), signal, expected);
  results[path + ("question" in request ? `:${request.question}` : "")] = events;
  if (terminal.type === "error") throw new Error(`${terminal.code}: ${terminal.message}`);
  assert.equal(terminal.fixture, false);
  return terminal;
}
async function main() {
  await check("health, decisions and detail contract", async () => {
    const health = (await json("health")).body; const list = (await json("decisions")).body; const detail = (await json("decisions/pep-0386")).body;
    assert(validateHealth(health)); assert(validateList(list)); assert(validateDetail(detail));
    assert.equal(health.snapshot_id, list.snapshot_id); assert.equal(health.corpus.documents, list.documents.length);
    results.corpus = { health, list, detail };
    console.log(JSON.stringify({ snapshot: health.snapshot_id, counts: health.corpus }));
  });
  await check("386 LIVE, at least three citations with header and PEP 440 evidence", async () => {
    const answer = await stream("ask", { question: scenarios[0].question, mode_preference: "AUTO" }, "answer_completed");
    assert.equal(answer.type, "answer_completed"); if (answer.type !== "answer_completed") return;
    assert.equal(answer.provenance.mode_used, "LIVE"); assert(answer.citations.length >= 3);
    assert([...answer.citations, ...answer.evidence_edges.filter(e => e.origin === "source_header").flatMap(e => e.supporting_evidence)].some(c => c.doc_id === "pep-0386" && c.locator.toLowerCase() === "header" && /Superseded-By:\s*440/.test(c.quote)), "Missing PEP 386 source-header quote");
    assert(answer.citations.some(c => c.doc_id === "pep-0440" && c.quote.trim()), "Missing PEP 440 citation"); assert.equal(answer.abstained, false);
    assert(answer.evidence_edges.some(e => e.source_doc_id === "pep-0386" && e.target_doc_id === "pep-0440" && e.relation === "superseded_by"));
    console.log(JSON.stringify({ mode: answer.provenance.mode_used, citations: answer.citations.length, edges: answer.evidence_edges.length }));
  });
  await check("563 explicit missing 749 successor", async () => {
    const answer = await stream("ask", { question: scenarios[1].question, mode_preference: "AUTO" }, "answer_completed");
    assert(answer.evidence_edges.some(e => e.target_doc_id === "pep-0749" && !e.target_in_corpus));
  });
  await check("unsupported question abstains without citations", async () => {
    const answer = await stream("ask", { question: scenarios[2].question, mode_preference: "AUTO" }, "answer_completed");
    assert.equal(answer.type, "answer_completed"); if (answer.type !== "answer_completed") return;
    assert.equal(answer.abstained, true); assert.equal(answer.citations.length, 0);
  });
  await check("real proposal review", async () => {
    const terminal = await stream("proposals/review", { proposal_text: exampleProposal, mode_preference: "AUTO" }, "review_completed");
    assert.equal(terminal.type, "review_completed"); if (terminal.type !== "review_completed") return;
    assert(terminal.findings.length > 0); console.log(JSON.stringify({ mode: terminal.provenance.mode_used, findings: terminal.findings.length }));
  });
  results.draft_indexing = "Deferred: no live draft writes until Josh authorizes them.";
  results.failures = failures;
  await mkdir("test-results/live", { recursive: true }); await writeFile("test-results/live/smoke.json", JSON.stringify(results, null, 2));
  if (failures.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
