import assert from "node:assert/strict";
import { test } from "node:test";
import { docLabel } from "../src/lib/contracts";
import { isCafeCorpus } from "../src/lib/corpus";
import { validateHealth, validateList, validateDetail, validateEvent } from "../src/lib/validation";
import { cafeHealth, cafeList, cafeDetail, cafeAnswer, cafeGap, cafeSchedule, cafeAbstention, cafeReview, stream } from "./cafe-responses";

test("document labels preserve PEP formatting and café padding without rewriting unknown IDs", () => {
  assert.equal(docLabel("pep-0386"), "PEP 386");
  assert.equal(docLabel("pep-0008"), "PEP 8");
  assert.equal(docLabel("dr-002"), "DR-002");
  assert.equal(docLabel("proposal"), "Proposal");
  assert.equal(docLabel("draft:abc"), "draft:abc");
  assert.equal(docLabel("pep-unknown"), "pep-unknown");
});
test("café detection accepts either snapshot prefix or document prefix and leaves PEPs unchanged", () => {
  assert.equal(isCafeCorpus(cafeHealth, null), true);
  assert.equal(isCafeCorpus(null, cafeList), true);
  assert.equal(isCafeCorpus({ ...cafeHealth, snapshot_id: "other-snapshot" }, cafeList), true);
  assert.equal(isCafeCorpus({ ...cafeHealth, snapshot_id: "peps-snapshot" }, { snapshot_id: "peps-snapshot", documents: [] }), false);
  assert.equal(isCafeCorpus(null, null), false);
});
test("local café response vectors conform to unchanged generated schemas, including the gap and Accepted/superseded case", () => {
  assert.ok(validateHealth(cafeHealth), JSON.stringify(validateHealth.errors));
  assert.ok(validateList(cafeList), JSON.stringify(validateList.errors));
  assert.ok(validateDetail(cafeDetail), JSON.stringify(validateDetail.errors));
  for (const result of [cafeAnswer, cafeGap, cafeSchedule, cafeAbstention, cafeReview]) {
    for (const event of stream(result)) assert.ok(validateEvent(event), JSON.stringify(validateEvent.errors));
  }
  const accepted = cafeList.documents.find(doc => doc.doc_id === "dr-009")!;
  assert.equal(accepted.source_status, "Accepted");
  assert.equal(accepted.superseded_by[0].doc_id, "dr-018");
  assert.equal(cafeGap.evidence_edges.find(edge => edge.target_doc_id === "dr-021")?.target_in_corpus, false);
});
