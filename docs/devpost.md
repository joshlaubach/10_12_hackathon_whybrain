# DevPost entry draft

Edit before pasting, and refine after the demo so it matches what actually works. Every `[CONFIRM: ...]` below is a claim that is not true until it has been checked; replace or delete each one before the 10 pm final submission.

**Title:** Why Brain

**Elevator pitch (200 characters max):** Ask “why did we decide that?” Get cited reasons, what replaced the decision, and a check of your new proposal against past decisions, so teams stop repeating or reversing old calls.

**Tagline:** Ask "Why did we decide that?" and get the cited reasoning, the decision that replaced it, and a check on your new proposal.

**Built with:** HydraDB, Anthropic Claude (Sonnet), Python, FastAPI, Pydantic, Next.js, TypeScript.

**Try it:** repo https://github.com/joshlaubach/10_12_hackathon_whybrain ; demo video link goes here after 10 pm.

---

# Project Story (paste this into the DevPost story box)

## Inspiration

Every team has a decision nobody can explain. The document is half remembered, the thread is buried, and someone is still following a rule that was replaced two years ago. Python's PEPs are a public version of the same problem: real decision records with `Replaces` and `Superseded-By` links, and plenty of people who still quote the old one.

We wanted a company brain that does more than retrieve text. It should answer "why did we decide that?", say what replaced the decision, and check a new idea against the record before someone repeats or reverses a past call.

## What it does

You ask a question in plain language. An agent retrieves the relevant records from HydraDB, follows what superseded what, and answers with quoted citations and a small evidence graph. When the record cannot support an answer, it says so instead of guessing.

It keeps three things apart that most tools blur together: the status recorded in the source (Final, Superseded, Withdrawn), whether a newer record superseded it as of our corpus snapshot, and conflicts the model only inferred. If a successor is not in the corpus, the graph shows an explicit gap rather than hiding it.

Then it takes action. Paste a new proposal and Why Brain lists the past decisions it may contradict, repeat, or suggest replacing, each with a quote, an explanation and an uncertainty, plus the recorded contacts from those sources (authors, not current owners). You can save the proposal as a draft labeled PROPOSAL. The draft goes into the brain separately from accepted decisions, is read back to confirm it landed, and never rewrites history.

The demo corpus is 24 public PEPs. The story: why was PEP 386 replaced by PEP 440, what would a proposal that reverts part of PEP 440 collide with, and what happens when we save it.

## How we built it

A Python/FastAPI backend and a Next.js/TypeScript frontend, joined by one contract. The contract is written once as Pydantic models and generates the OpenAPI file, the TypeScript types and the test fixtures, so the two sides cannot drift. Josh directed the build and made the judgment calls (corpus, ground-truth cases, what counts as relevant evidence, the demo narrative). Claude Code built the backend and the contract; Codex built the interface.

HydraDB stores and retrieves the records. Claude (Sonnet) runs the agent loop with tools to search the brain, read a decision, follow edges, check status and look for conflicts. The agent chooses what to fetch next and when to stop, but supersession comes from the source headers, never from the model. Every quote is checked against its source text. Answers stream as events with request ids, and each answer reports what it actually used (LIVE, LOCAL or REPLAY) from per-request provenance, not from configuration. [CONFIRM: which HydraDB features we used, including whether graph traversal is HydraDB's or our own header graph.]

## Challenges we ran into

- A Final document can still be superseded. PEP 333 is Final and was superseded by PEP 3333, so lifecycle status and supersession had to be separate fields.
- Real corpora have holes. PEP 563 names PEP 749 as a successor and PEP 291 names PEP 387, and neither is in our snapshot. We show the gap instead of inventing the missing record.
- Being honest about "live". LIVE only counts when HydraDB supplied evidence that appears in the answer and the model call completed. Failed or merely attempted calls do not qualify, and fixture playback is always labeled "Mock data".
- Indexing is asynchronous, so an uploaded draft is not searchable yet. A draft is only "indexed" after we read it back from the store, and the backend's cached save response does not count.
- A proposal must never rewrite accepted history. Proposals only create a `proposes_to_replace` relation, live in a separate collection, and reusing a draft id with different content returns a conflict.
- Four hours, two AI coding agents and one human. Disjoint file ownership and a generated contract kept the work parallel. [CONFIRM: add the real surprises from the afternoon.]

## Accomplishments that we're proud of

- A contract-first build: one Pydantic source generates the OpenAPI file, TypeScript types and 14 fixtures, with 28 tests that check that every quote appears in its source and every header edge matches the corpus.
- Evidence-first design: the interface draws only typed evidence edges from the response and never infers relationships from prose.
- [CONFIRM after the demo: the full story ran end to end on live HydraDB and model calls (explain 386, review a proposal, save a draft, retrieve it).]
- [CONFIRM after the evaluation: results of the paired check, with and without graph expansion, with raw counts and the failures we found.]

## What we learned

- Decision memory is about relationships and status, not only similarity. A search that finds the old record is not the same as a system that knows it was replaced. [CONFIRM with evaluation results before claiming a size for this.]
- Make deterministic whatever can be deterministic, and let the model explain. Supersession and quote checks do not need a model's opinion.
- "Saved" has to mean "we could read it back". A quote that appears in a source proves it was quoted accurately, not that it supports the conclusion; that still takes a human.
- Parallel coding agents work when the contract and the file ownership are explicit before anyone starts.

## What's next for WhyBrain

- Bring your own folder: upload ADRs, RFCs, meeting notes and tickets and build the graph from them.
- Live connections to Slack, Notion, GitHub and Jira.
- Real ownership: evidence for who owns a decision today, instead of recorded authors.
- Time travel: show what was current on a past date.
- A larger paired evaluation with failure analysis, not just a small curated set.
- Alerts when a new proposal collides with an existing decision.

---

# Notes for Josh (not part of the story)

**How the story maps to the judging criteria**

- Technical execution: generated contract, streamed agent steps, verified quotes, contract test suite, per-request mode reporting.
- Use of the brain: content is uploaded into HydraDB, retrieved by meaning and connected through supersession links; review and draft both read and write the same brain. [CONFIRM which HydraDB graph features are used.]
- Agentic capability: the agent chooses evidence, follows successors, abstains, and ends in a reviewed, saved proposal.
- Creativity: evidence-first decision memory; supersession from headers, gaps shown.
- Real-world value: any team with ADRs, RFCs or design docs has this problem.

**Honest limits to keep in the submission:** one corpus snapshot; authors are recorded contacts, not current owners; a historical record is not necessarily today's specification; the evaluation is a small curated set, not a claim of broad reliability.
