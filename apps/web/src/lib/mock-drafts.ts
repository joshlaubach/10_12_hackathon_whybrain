import { createHash } from "node:crypto";
import type { Schema } from "./contracts";
import { ApiError } from "./errors";

type Entry = { record: Schema<"DraftRecord">; reads: number; outcome: "indexed" | "failed" };
const scope = globalThis as typeof globalThis & { whybrainMockDrafts?: Map<string, Entry> };
const store = scope.whybrainMockDrafts ??= new Map<string, Entry>();

export function createMockDraft(request: Schema<"DraftCreateRequest">, outcome: Entry["outcome"] = "indexed") {
  const normalized = { title: request.title.trim(), body_md: request.body_md.trim(), proposes_to_replace: [...new Set(request.proposes_to_replace)].sort() };
  const content_hash = `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
  const existing = store.get(request.draft_id);
  if (existing) {
    if (existing.record.content_hash !== content_hash) throw new ApiError({ code: "draft_conflict", message: "This draft ID already contains different content. Use Save as new draft to keep your edits.", request_id: null, retryable: false });
    return { record: { ...existing.record }, created: false };
  }
  const record: Schema<"DraftRecord"> = { ...normalized, draft_id: request.draft_id, content_hash, label: "PROPOSAL", status: "pending", provider_indexing: "pending", retrieval_verification: "pending", verified_via: null, error: null, fixture: true };
  store.set(request.draft_id, { record, reads: 0, outcome });
  return { record: { ...record }, created: true };
}

export function getMockDraft(id: string): Schema<"DraftRecord"> {
  const entry = store.get(id);
  if (!entry) throw new ApiError({ code: "not_found", message: "This mock draft is not available. Mock drafts last until the web server restarts.", request_id: null, retryable: false });
  entry.reads++;
  if (entry.outcome === "failed") {
    entry.record = { ...entry.record, status: "failed", provider_indexing: "failed", retrieval_verification: "failed", error: "Recorded simulation: indexing failed. Save as a new draft to retry." };
  } else if (entry.reads === 1) {
    entry.record = { ...entry.record, provider_indexing: "completed" };
  } else {
    // Simulation only; fixture:true must remain visible. No provider is contacted.
    entry.record = { ...entry.record, status: "indexed", provider_indexing: "completed", retrieval_verification: "verified", verified_via: "local_store" };
  }
  return { ...entry.record };
}
