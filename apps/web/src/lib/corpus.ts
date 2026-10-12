import type { Schema } from "./contracts";

export function isCafeCorpus(health: Schema<"HealthResponse"> | null, list: Schema<"DecisionList"> | null) {
  return !!health?.snapshot_id.startsWith("cafe-") || !!list?.documents.some(doc => doc.doc_id.startsWith("dr-"));
}

export const cafeQuestions = [
  "Why can customers get a refund without a receipt?",
  "When are we open?",
  "Who owns the loyalty program now?",
] as const;

export const cafeProposals = [
  "Go back to refunds only within 7 days with a receipt, to cut fraud.",
  "Put a sign by the register explaining the 30-day refund policy.",
] as const;
