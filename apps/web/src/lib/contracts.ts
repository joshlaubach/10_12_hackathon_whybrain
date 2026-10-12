import type { components } from "@contracts/src/api";

// All API payloads are aliases of the generated contract, never copies.
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];
export type Terminal = Schema<"AnswerCompleted"> | Schema<"ReviewCompleted">;
export type Transport = "mock" | "api";

export function docLabel(id: string) {
  const [prefix, suffix] = id.split("-");
  if (prefix === "pep" && /^\d+$/.test(suffix ?? "")) return `PEP ${Number(suffix)}`;
  if (prefix === "dr" && /^\d+$/.test(suffix ?? "")) return id.toUpperCase();
  return id === "proposal" ? "Proposal" : id;
}

export const relationLabel: Record<Schema<"EvidenceEdge">["relation"], string> = {
  superseded_by: "Superseded by",
  replaces: "Replaces",
  proposes_to_replace: "Suggested replacement (not an accepted change)",
  potential_conflict: "Potential conflict (inferred)",
};

export const findingLabel: Record<Schema<"ProposalFinding">["relation"], string> = {
  may_contradict: "May contradict",
  may_repeat: "May repeat",
  suggests_replacing: "Suggested replacement (not an accepted change)",
};
