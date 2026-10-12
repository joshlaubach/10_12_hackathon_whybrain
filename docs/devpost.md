# DevPost entry draft

No unverified placeholders remain. Every claim below reflects something that has been checked as of about 3:20 PM on Oct 12. Re-read it after your rehearsal and the evaluation, and add the evaluation results and any end-to-end draft result only once they are real.

**Title:** yBrain

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

yBrain (pronounced "why-brain") is a company brain for decision records. You ask a question in plain language. An agent retrieves the relevant records from HydraDB, follows what superseded what using the links in the source headers, and answers with quoted citations and a small evidence graph. When the record cannot support an answer, it says so instead of guessing.

It keeps three things apart that most tools blur together: the status recorded in the source (Final, Superseded, Withdrawn), whether a newer record superseded it as of our corpus snapshot, and conflicts the model only inferred. If a successor is not in the corpus, the graph shows an explicit gap rather than hiding it.

Then it takes action. Paste a new proposal and yBrain lists the past decisions it may contradict, repeat, or suggest replacing, each with a quote, an explanation and an uncertainty, plus the recorded contacts from those sources (authors, not current owners). You can save the proposal as a draft labeled PROPOSAL. The draft goes into the brain separately from accepted decisions, is read back to confirm it landed, and never rewrites history.

The demo corpus is 24 public PEPs. The story: why was PEP 386 replaced by PEP 440, what would a proposal that reverts part of PEP 440 collide with, and what happens when we save it.

## How we built it

A Python/FastAPI backend and a Next.js/TypeScript frontend, joined by one contract. The contract is written once as Pydantic models and generates the OpenAPI file, the TypeScript types and the test fixtures, so the two sides cannot drift. Josh directed the build and made the judgment calls (corpus, ground-truth cases, what counts as relevant evidence, the demo narrative). Claude Code built the backend and the contract; Codex built the interface.

HydraDB stores and retrieves the records. Claude (Sonnet) runs the agent loop with tools to search the brain, read a decision, follow edges, check status and look for conflicts. The agent chooses what to fetch next and when to stop, but supersession comes from the source headers, never from the model. Every quote is checked against its source text. Answers stream as events with request ids, and each answer reports what it actually used (LIVE, LOCAL or REPLAY) from per-request provenance, not from configuration.

HydraDB features we use: document ingestion with asynchronous indexing (we poll until each record is searchable), ranked retrieval that returns verbatim chunk text we can quote-check, and graph context, the relations HydraDB extracts from the text. Those extracted relations are a supporting signal only. HydraDB has no "follow the Superseded-By link" operation, and its extracted graph is built from prose by a model, so the graph we draw and the supersession we report come from our own header graph, which is deterministic. Drafts live in their own HydraDB collection, separate from the accepted decisions.

## Challenges we ran into

- A Final document can still be superseded. PEP 333 is Final and was superseded by PEP 3333, so lifecycle status and supersession had to be separate fields.
- Real corpora have holes. PEP 563 names PEP 749 as a successor and PEP 291 names PEP 387, and neither is in our snapshot. We show the gap instead of inventing the missing record.
- Being honest about "live". LIVE only counts when HydraDB supplied evidence that appears in the answer and the model call completed. Failed or merely attempted calls do not qualify, and fixture playback is always labeled "Mock data".
- Indexing is asynchronous, so an uploaded draft is not searchable yet. A draft is only "indexed" after we read it back from the store, and the backend's cached save response does not count.
- A proposal must never rewrite accepted history. Proposals only create a `proposes_to_replace` relation, live in a separate collection, and reusing a draft id with different content returns a conflict.
- HydraDB's extracted graph is noisy. For PEP 386 alone it returned about 70 relations, including one that read "'dev' replaced with '@'" under the predicate `replaces`. It also gave us no way to follow a relation, and its subgraph lookup returned nothing for our documents. That is why edges come from the source headers and HydraDB's relations are only a supporting signal.
- Format and speed. HydraDB rejected our `.rst` files, so we upload the PEPs as `.txt`. Indexing took about 96 seconds per document one at a time; four concurrent uploads brought it to about 60 seconds each. Indexing a saved draft took anywhere from about one to two minutes on a quiet system to about six minutes once, and in one test a draft passed our ten-minute limit. The interface shows a draft as pending until it has been read back from HydraDB, and that test draft was shown as failed instead of being reported as saved.
- Model output varies. The same 386 question returned four citations on one run and five on the next, so our live checks assert what must be true (the header edge, verified quotes from both decisions) rather than exact counts.
- Four hours, two AI coding agents and one human. Disjoint file ownership and a generated contract kept the work parallel.

## Accomplishments that we're proud of

- A contract-first build: one Pydantic source generates the OpenAPI file, TypeScript types and 14 fixtures, with a backend suite of 47 tests that check, among other things, that every quote appears in its source and every header edge matches the corpus.
- Evidence-first design: the interface draws only typed evidence edges from the response and never infers relationships from prose.
- Every step of the backend story has run against real HydraDB and Sonnet calls: the 386-to-440 answer with verified citations, the PEP 563 answer with PEP 749 shown as a gap, an abstention on a question the record cannot answer, a proposal review, and a draft that went from pending to indexed only after it was read back from HydraDB.
- The interface runs the same flows against the live API in a real browser: the 386 answer with the LIVE badge and no mock data, the PEP 563 gap, the abstention, and the proposal review with recorded contacts. Its test suite covers the stream protocol, the mock-versus-live labels and the draft states.

## What we learned

- Decision memory is about relationships and status, not only similarity. A search that finds the old record is not the same as a system that knows it was replaced.
- Make deterministic whatever can be deterministic, and let the model explain. Supersession and quote checks do not need a model's opinion. HydraDB's extracted graph made this concrete: it is a useful hint and a bad authority.
- "Saved" has to mean "we could read it back". A quote that appears in a source proves it was quoted accurately, not that it supports the conclusion; that still takes a human.
- Parallel coding agents work when the contract and the file ownership are explicit before anyone starts.

## What's next for yBrain

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
- Use of the brain: content is uploaded into HydraDB, retrieved by meaning, and connected through supersession links from the source headers; HydraDB's extracted graph context is used as a supporting signal; review and draft both read and write the same brain (drafts in a separate collection).
- Agentic capability: the agent chooses evidence, follows successors, abstains, and ends in a reviewed, saved proposal.
- Creativity: evidence-first decision memory; supersession from headers, gaps shown.
- Real-world value: any team with ADRs, RFCs or design docs has this problem.

**Honest limits to keep in the submission:** one corpus snapshot; authors are recorded contacts, not current owners; a historical record is not necessarily today's specification; HydraDB's graph relations are model-extracted and noisy, so they are not used as authority; a saved draft can take from one to two minutes to several minutes to become searchable, and in one test it passed our ten-minute limit and was shown as failed; the evaluation is a small curated set, not a claim of broad reliability.

**Where the new facts come from:** the HydraDB findings (extracted triplets, 70 relations for PEP 386, the `'dev' replaced with '@'` example, no relation-following operation, empty subgraph, `.rst` rejected, 96 s and 60 s indexing) and the live backend results come from the local Claude Code spike and Step 1-5 report; the 47-test count was re-run on `main` before this edit and passes. Re-check the live claims in your rehearsal before submitting, and update the test count if it changes.
