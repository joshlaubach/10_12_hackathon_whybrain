import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Schema } from "../src/lib/contracts";
import { consumeSSE, checkResponse } from "../src/lib/sse";
import { validateHealth, validateList, validateDetail, validateDraft } from "../src/lib/validation";
import { scenarios, exampleProposal } from "../src/lib/scenarios";

const base = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const resumeId = process.argv[process.argv.indexOf("--draft-id") + 1];
const resume = process.argv.includes("--draft-id") ? resumeId : undefined;
if (process.argv.includes("--draft-id") && (!resume || resume.startsWith("--"))) throw new Error("--draft-id requires the UUID of an existing draft.");
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
  await check("386 LIVE, four citations and source-header graph", async () => {
    const answer = await stream("ask", { question: scenarios[0].question, mode_preference: "AUTO" }, "answer_completed");
    assert.equal(answer.type, "answer_completed"); if (answer.type !== "answer_completed") return;
    assert.equal(answer.provenance.mode_used, "LIVE"); assert.equal(answer.citations.length, 4); assert.equal(answer.abstained, false);
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
  let review: Schema<"ReviewCompleted"> | undefined;
  await check("real proposal review", async () => {
    const terminal = await stream("proposals/review", { proposal_text: exampleProposal, mode_preference: "AUTO" }, "review_completed");
    assert.equal(terminal.type, "review_completed"); if (terminal.type !== "review_completed") return;
    review = terminal; assert(review.findings.length > 0); console.log(JSON.stringify({ mode: review.provenance.mode_used, findings: review.findings.length }));
  });
  await check("draft pending to indexed, verified retrieval, idempotency", async () => {
    assert(review, "Review must succeed before saving its draft");
    const prior = resume ? (await json(`drafts/${encodeURIComponent(resume)}`)).body : null;
    if (resume) assert(validateDraft(prior));
    const request: Schema<"DraftCreateRequest"> = prior && validateDraft(prior) ? { draft_id: prior.draft_id, title: prior.title, body_md: prior.body_md, proposes_to_replace: prior.proposes_to_replace } : { draft_id: crypto.randomUUID(), title: "Live integration check: development release ordering", body_md: review.draft_md, proposes_to_replace: [...new Set(review.evidence_edges.filter(e => e.relation === "proposes_to_replace").map(e => e.target_doc_id))] };
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) };
    const created = await json("drafts", init); assert.equal(created.status, resume ? 200 : 201); assert(validateDraft(created.body)); if (!resume) assert.equal(created.body.status, "pending");
    const states: Schema<"DraftRecord">[] = [created.body]; results.draft = states;
    console.log(JSON.stringify({ draft_id: created.body.draft_id, status: created.body.status, resumed: Boolean(resume) }));
    let record = created.body; const deadline = Date.now() + 660000;
    while (record.status === "pending" && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 900)); const next = (await json(`drafts/${request.draft_id}`)).body; assert(validateDraft(next)); record = next; states.push(record); }
    assert.equal(record.status, "indexed", record.error || "Draft did not finish indexing"); assert.equal(record.provider_indexing, "completed"); assert.equal(record.retrieval_verification, "verified"); assert(record.verified_via); assert.equal(record.fixture, false);
    const existing = await json("drafts", init); assert.equal(existing.status, 200); assert(validateDraft(existing.body)); assert.equal(existing.body.content_hash, record.content_hash);
    console.log(JSON.stringify({ draft_id: record.draft_id, statuses: [...new Set(states.map(s => s.status))], polls: states.length - 1, verified_via: record.verified_via }));
  });
  results.failures = failures;
  await mkdir("test-results/live", { recursive: true }); await writeFile("test-results/live/smoke.json", JSON.stringify(results, null, 2));
  if (failures.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
