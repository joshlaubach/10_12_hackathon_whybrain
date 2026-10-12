import type { Schema, Terminal } from "../src/lib/contracts";

// Isolated intercepted responses; never used by the app's PEP mock routes.
export const snapshot = "cafe-5ed395beac31";
export const sourceUrl = (id: string) => `https://github.com/joshlaubach/10_12_hackathon_whybrain/blob/main/data/cafe/${id}.txt`;
const ref = (id: string): Schema<"DocRef"> => ({ doc_id: id, source_url: sourceUrl(id), in_corpus: id !== "dr-021" });
const document = (id: string, title: string, status: string, successors: string[] = [], replaces: string[] = []): Schema<"Document"> => ({
  doc_id: id, title, source_status: status, source_url: sourceUrl(id), authors: ["Maria Alvarez"],
  discussions_to: "#cafe-decisions (team chat)", resolution_url: null, snapshot_id: snapshot,
  superseded_by: successors.map(ref), replaces: replaces.map(ref), missing_successors: successors.filter(id => id === "dr-021"),
});
export const cafeList: Schema<"DecisionList"> = { snapshot_id: snapshot, documents: [
  document("dr-002", "Refund policy v1", "Superseded", ["dr-014"]),
  document("dr-005", "Opening hours v1", "Superseded", ["dr-016", "dr-021"]),
  document("dr-007", "Switch to compostable cups", "Withdrawn"),
  { ...document("dr-009", "Weekly schedule on paper", "Accepted", ["dr-018"]), authors: ["Devon Park"] },
  { ...document("dr-011", "Loyalty program, tenth drink free", "Accepted"), authors: ["Priya Nair"] },
  { ...document("dr-014", "Refund policy v2", "Accepted", [], ["dr-002"]), authors: ["Maria Alvarez", "Devon Park"] },
  { ...document("dr-016", "Weekday hours", "Accepted", [], ["dr-005"]), authors: ["Maria Alvarez", "Devon Park"] },
  { ...document("dr-018", "Schedules and shift swaps in the team chat", "Accepted", [], ["dr-009"]), authors: ["Devon Park", "Sam Okafor"] },
  document("dr-020", "Buy beans from Harbor Roasters", "Accepted"),
] };
export const cafeHealth: Schema<"HealthResponse"> = {
  status: "ok", configured: { hydradb: true, anthropic: true }, snapshot_id: snapshot,
  corpus: { documents: cafeList.documents.length, source_header_edges: cafeList.documents.reduce((count, doc) => count + doc.superseded_by.length + doc.replaces.length, 0), missing_successors: 1 }, note: "Configuration only.",
};
export const refundQuote = "Refunds are allowed within 30 days, and no receipt is needed.";
const citation = (id: string, quote: string, locator = "Header"): Schema<"Citation"> => ({ doc_id: id, quote, locator, source_url: sourceUrl(id) });
const headerEdge = (source: string, target: string, quote: string): Schema<"EvidenceEdge"> => ({
  edge_id: `${source}-${target}`, source_doc_id: source, target_doc_id: target,
  relation: "superseded_by", origin: "source_header", target_in_corpus: target !== "dr-021",
  supporting_evidence: [{ doc_id: source, quote, locator: "Header" }], explanation: null, uncertainty: null,
});
const provenance: Schema<"Provenance"> = { mode_used: "LIVE", hydradb_requests: 1, hydradb_failures: 0,
  hydradb_evidence_doc_ids: ["dr-002", "dr-014"], model_requests: 1, model_failures: 0, model_completed: true };
export const cafeAnswer: Schema<"AnswerCompleted"> = {
  type: "answer_completed", request_id: "cafe-answer", seq: 1, fixture: false, as_of: snapshot, provenance,
  answer: "DR-014 replaced the receipt-only policy. Customers can get refunds within 30 days without a receipt.",
  abstained: false, abstain_reason: null,
  citations: [citation("dr-002", "Superseded-By: DR-014"), citation("dr-014", refundQuote, "Decision")],
  inspected_doc_ids: ["dr-002", "dr-014"], evidence_edges: [headerEdge("dr-002", "dr-014", "Superseded-By: DR-014")],
};
export const cafeGap: Schema<"AnswerCompleted"> = { ...cafeAnswer,
  answer: "DR-005 names DR-016 and DR-021 as successors. DR-016 sets weekday hours; DR-021 is absent, so weekend hours cannot be established.",
  citations: [citation("dr-005", "Superseded-By: DR-016, DR-021"), citation("dr-016", "On weekdays the café is open from 7am to 6pm.", "Decision")],
  inspected_doc_ids: ["dr-005", "dr-016"], evidence_edges: [headerEdge("dr-005", "dr-016", "Superseded-By: DR-016, DR-021"), headerEdge("dr-005", "dr-021", "Superseded-By: DR-016, DR-021")],
};
export const cafeSchedule: Schema<"AnswerCompleted"> = { ...cafeAnswer,
  answer: "The Accepted source DR-009 was superseded by DR-018 according to its header.",
  citations: [citation("dr-009", "Superseded-By: DR-018")], inspected_doc_ids: ["dr-009", "dr-018"],
  evidence_edges: [headerEdge("dr-009", "dr-018", "Superseded-By: DR-018")],
};
export const cafeAbstention: Schema<"AnswerCompleted"> = { ...cafeAnswer,
  answer: "", abstained: true, abstain_reason: "The record names Priya Nair as a recorded contact, not a current owner.",
  citations: [], inspected_doc_ids: ["dr-011"], evidence_edges: [],
};
export const cafeReview: Schema<"ReviewCompleted"> = {
  type: "review_completed", request_id: "cafe-review", seq: 1, fixture: false, as_of: snapshot, provenance,
  findings: [{ finding_id: "refund-conflict", claim: "Require a receipt within 7 days", ...citation("dr-014", refundQuote, "Decision"),
    relation: "suggests_replacing", explanation: "The proposal would replace the recorded 30-day, no-receipt rule.", uncertainty: "low" }],
  inspected_doc_ids: ["dr-014"], evidence_edges: [{ ...headerEdge("proposal", "dr-014", refundQuote),
    supporting_evidence: [{ doc_id: "dr-014", quote: refundQuote, locator: "Decision" }], origin: "proposal", relation: "proposes_to_replace" }],
  recorded_contacts: ["Maria Alvarez", "Devon Park"],
  draft_md: "# Proposal: receipt-only refunds\n\nStatus: Draft (PROPOSAL, not accepted)\n\nProposes-To-Replace: DR-014 (suggestion only)\n\nRequire a receipt and a 7-day window; address the recorded rationale before acceptance.",
};
export const cafeDetail: Schema<"DecisionDetail"> = { ...cafeList.documents.find(doc => doc.doc_id === "dr-018")!,
  body_text: "The schedule is posted in the team chat app, and shift swaps are agreed there too.",
  sections: [{ heading: "Decision", locator: "Decision", text: "The schedule is posted in the team chat app, and shift swaps are agreed there too." }],
};
export function stream(result: Terminal): Schema<"StreamEvent">[] {
  return [{ type: "request_started", request_id: result.request_id, seq: 0, fixture: false, mode: result.provenance.mode_used, snapshot_id: result.as_of }, result];
}
