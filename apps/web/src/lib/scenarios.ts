export const scenarios = [
  { id: "386", label: "Supersession", question: "Why was PEP 386 replaced by PEP 440?", file: "stream_ask_386_440" },
  { id: "563", label: "Missing successor", question: "What superseded PEP 563, and what evidence is missing?", file: "stream_ask_missing_successor_563" },
  { id: "unsupported", label: "Unsupported question", question: "Who currently owns Python packaging?", file: "stream_ask_unsupported" },
  { id: "error", label: "Model unavailable", question: "Show the recorded model-unavailable example.", file: "stream_error_model_unavailable" },
] as const;

export const exampleProposal = "Sort development releases between the last release candidate and the final release, so that dev builds sort after rc builds.";
