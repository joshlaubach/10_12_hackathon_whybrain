import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockDraft, getMockDraft } from "../src/lib/mock-drafts";
import type { Schema } from "../src/lib/contracts";

const draft = (): Schema<"DraftCreateRequest"> => ({ draft_id: crypto.randomUUID(), title: "A proposal", body_md: "Address the cited rationale.", proposes_to_replace: ["pep-0440"] });

test("same ID and normalized content returns the existing mock record", () => {
  const request = draft();
  const first = createMockDraft(request);
  const again = createMockDraft({ ...request, title: ` ${request.title} ` });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.record.content_hash, first.record.content_hash);
});
test("different content under the same ID is draft_conflict", () => {
  const request = draft(); createMockDraft(request);
  assert.throws(() => createMockDraft({ ...request, body_md: "Changed" }), { code: "draft_conflict" });
});
test("mock provider completion and retrieval verification are separate stages", () => {
  const request = draft();
  assert.equal(createMockDraft(request).record.status, "pending");
  const indexing = getMockDraft(request.draft_id);
  assert.equal(indexing.provider_indexing, "completed");
  assert.equal(indexing.retrieval_verification, "pending");
  assert.equal(indexing.status, "pending");
  const verified = getMockDraft(request.draft_id);
  assert.equal(verified.status, "indexed");
  assert.equal(verified.fixture, true);
  assert.equal(verified.retrieval_verification, "verified");
});
test("mock failure remains failed, never indexed", () => {
  const request = draft(); createMockDraft(request, "failed");
  const failed = getMockDraft(request.draft_id);
  assert.equal(failed.status, "failed");
  assert.equal(getMockDraft(request.draft_id).status, "failed");
});
